"""Local meal planner with recipes and a generated native shopping list."""
import asyncio
from copy import deepcopy
import logging

from .compat import vol
from homeassistant.components import websocket_api
from homeassistant.core import callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.event import async_track_time_change
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import CONF_MEALS_PER_DAY, CONF_NUTRITION_ENABLED, DEFAULT_MEALS_PER_DAY, DOMAIN, PLATFORMS
from .model import initial_state, mutate, normalize_state, shopping
from .frontend import async_register_frontend, async_setup_frontend_entry, async_unload_frontend_entry
from .sync import ShoppingSync
from .nutrition import candidates, ingredient_overview, search_index, summary, totals
from .products import ProductLookup

_LOGGER = logging.getLogger(__name__)


class Planner:
    def __init__(self, hass, meals_per_day=DEFAULT_MEALS_PER_DAY, *, nutrition_enabled=False):
        self.hass = hass
        self.meals_per_day = meals_per_day
        self.nutrition_enabled = nutrition_enabled
        self.store = Store(hass, 1, DOMAIN)
        self.state = initial_state()
        self.lock = asyncio.Lock()
        self.listeners = set()

    def subscribe(self, listener):
        self.listeners.add(listener)
        return lambda: self.listeners.discard(listener)

    @callback
    def notify(self, *_):
        for listener in tuple(self.listeners):
            listener()

    def snapshot(self):
        result = deepcopy(self.state)
        result['meals_per_day'] = self.meals_per_day
        result['modules'] = {'nutrition': self.nutrition_enabled}
        if self.nutrition_enabled:
            ingredients = self.state.get('ingredients', {})
            # Compact on purpose: every open card loads this snapshot. The ingredient
            # list is fetched separately by the dialogs that need it.
            result['nutrition'] = {rid: summary(totals(recipe, ingredients))
                                   for rid, recipe in self.state['recipes'].items()}
        result['today'] = dt_util.now().date().isoformat()
        result['shopping'] = shopping(self.state, result['today'])
        return result

    async def change(self, operation, payload, revision=None):
        async with self.lock:
            if revision is not None and revision != self.state['revision']:
                raise ValueError('Daten wurden inzwischen geändert. Bitte neu laden und erneut versuchen.')
            if operation in ('set_nutrition', 'set_ingredients', 'save_amounts') and not self.nutrition_enabled:
                raise ValueError('Das Nährwertmodul ist deaktiviert')
            new = mutate(self.state, operation, payload, dt_util.now().date().isoformat(), self.meals_per_day)
            await self.store.async_save(new)
            self.state = new
            self.notify()
            return self.snapshot()


async def async_setup(hass, config):
    await async_register_frontend(hass)
    websocket_api.async_register_command(hass, ws_get)
    websocket_api.async_register_command(hass, ws_change)
    websocket_api.async_register_command(hass, ws_nutrition_search)
    websocket_api.async_register_command(hass, ws_barcode_lookup)
    websocket_api.async_register_command(hass, ws_product_search)
    websocket_api.async_register_command(hass, ws_ingredients)
    websocket_api.async_register_command(hass, ws_subscribe)
    async def sync_shopping_list(call):
        planner = hass.data.get(DOMAIN)
        if planner is None:
            raise HomeAssistantError('Essensplan ist nicht geladen')
        await planner.sync.sync_now(call.data['retry_unconfirmed'])
    hass.services.async_register(DOMAIN, 'sync_shopping_list', sync_shopping_list,
        schema=vol.Schema({vol.Optional('retry_unconfirmed', default=False): bool}))
    return True


async def async_setup_entry(hass, entry):
    planner = Planner(
        hass,
        entry.options.get(CONF_MEALS_PER_DAY, DEFAULT_MEALS_PER_DAY),
        nutrition_enabled=entry.options.get(CONF_NUTRITION_ENABLED, False),
    )
    if planner.nutrition_enabled:
        await hass.async_add_executor_job(search_index)
        planner.products = ProductLookup(async_get_clientsession(hass))
    planner.state = normalize_state(await planner.store.async_load() or initial_state())
    planner.sync = ShoppingSync(hass, entry, planner)
    hass.data[DOMAIN] = planner
    entry.async_on_unload(async_track_time_change(hass, planner.notify, hour=0, minute=0, second=0))
    try:
        await async_setup_frontend_entry(hass)
        await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
        await planner.sync.start()
        entry.async_on_unload(entry.add_update_listener(_async_options_updated))
    except Exception:
        await planner.sync.stop()
        async_unload_frontend_entry(hass)
        hass.data.pop(DOMAIN, None)
        raise
    return True


async def async_unload_entry(hass, entry):
    if await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        await hass.data[DOMAIN].sync.stop()
        async_unload_frontend_entry(hass)
        hass.data.pop(DOMAIN, None)
        return True
    return False


async def _async_options_updated(hass, entry):
    await hass.config_entries.async_reload(entry.entry_id)


@websocket_api.websocket_command({vol.Required('type'): 'essensplan/get'})
@websocket_api.async_response
async def ws_get(hass, connection, msg):
    planner = hass.data.get(DOMAIN)
    if planner is None:
        connection.send_error(msg['id'], 'not_loaded', 'Essensplan ist nicht geladen')
        return
    connection.send_result(msg['id'], planner.snapshot())


@websocket_api.websocket_command({
    vol.Required('type'): 'essensplan/change',
    vol.Required('operation'): vol.In(['save_recipe', 'delete_recipe', 'set_meal', 'shopping_week', 'complete', 'favorite', 'shopping_amount', 'mark_cooked', 'set_nutrition', 'set_ingredients', 'save_amounts']),
    vol.Required('payload'): dict,
    vol.Required('revision'): vol.All(int, vol.Range(min=0)),
})
@websocket_api.async_response
async def ws_change(hass, connection, msg):
    # Meal data is shared household data, writable by ordinary authenticated users,
    # like a household to-do list. Read-only dashboard mode is not an access boundary.
    planner = hass.data.get(DOMAIN)
    if planner is None:
        connection.send_error(msg['id'], 'not_loaded', 'Essensplan ist nicht geladen')
        return
    try:
        result = await planner.change(msg['operation'], msg['payload'], msg['revision'])
    except (ValueError, KeyError, TypeError, AttributeError) as err:
        connection.send_error(msg['id'], 'invalid_input', str(err))
    except (OSError, HomeAssistantError):
        _LOGGER.exception('Essensplan konnte nicht gespeichert werden')
        connection.send_error(msg['id'], 'save_failed', 'Speichern fehlgeschlagen; Details im HA-Protokoll')
    else:
        connection.send_result(msg['id'], result)


@websocket_api.websocket_command({
    vol.Required('type'): 'essensplan/nutrition_search',
    vol.Required('queries'): [str],
})
@websocket_api.async_response
async def ws_nutrition_search(hass, connection, msg):
    planner = hass.data.get(DOMAIN)
    if planner is None or not planner.nutrition_enabled:
        connection.send_error(msg['id'], 'not_enabled', 'Das Nährwertmodul ist deaktiviert')
        return
    queries = msg['queries']
    if len(queries) > 100 or any(len(query) > 200 for query in queries):
        connection.send_error(msg['id'], 'invalid_input', 'Zu viele oder zu lange Suchbegriffe')
        return
    recipes, ingredients = planner.state['recipes'], planner.state.get('ingredients', {})
    results = await hass.async_add_executor_job(
        lambda: [candidates(query, recipes, ingredients) for query in queries])
    connection.send_result(msg['id'], results)


@websocket_api.websocket_command({
    vol.Required('type'): 'essensplan/barcode_lookup',
    vol.Required('barcode'): str,
})
@websocket_api.async_response
async def ws_barcode_lookup(hass, connection, msg):
    planner = hass.data.get(DOMAIN)
    if planner is None or not planner.nutrition_enabled:
        connection.send_error(msg['id'], 'not_enabled', 'Das Nährwertmodul ist deaktiviert')
        return
    try:
        product = await planner.products.find(msg['barcode'], planner.state)
    except (ValueError, TypeError, AttributeError) as err:
        connection.send_error(msg['id'], 'lookup_failed', str(err))
    else:
        connection.send_result(msg['id'], product)


@websocket_api.websocket_command({
    vol.Required('type'): 'essensplan/product_search',
    vol.Required('query'): str,
})
@websocket_api.async_response
async def ws_product_search(hass, connection, msg):
    planner = hass.data.get(DOMAIN)
    if planner is None or not planner.nutrition_enabled:
        connection.send_error(msg['id'], 'not_enabled', 'Das Nährwertmodul ist deaktiviert')
        return
    try:
        products = await planner.products.search(msg['query'])
    except (ValueError, TypeError, AttributeError) as err:
        connection.send_error(msg['id'], 'search_failed', str(err))
    else:
        connection.send_result(msg['id'], products)


@websocket_api.websocket_command({vol.Required('type'): 'essensplan/ingredients'})
@websocket_api.async_response
async def ws_ingredients(hass, connection, msg):
    planner = hass.data.get(DOMAIN)
    if planner is None or not planner.nutrition_enabled:
        connection.send_error(msg['id'], 'not_enabled', 'Das Nährwertmodul ist deaktiviert')
        return
    state = planner.state
    result = await hass.async_add_executor_job(ingredient_overview, state)
    connection.send_result(msg['id'], {'revision': state['revision'], 'ingredient_list': result})


@websocket_api.websocket_command({vol.Required('type'): 'essensplan/subscribe'})
@callback
def ws_subscribe(hass, connection, msg):
    """Tell open cards about changes and the new day instead of letting them poll."""
    planner = hass.data.get(DOMAIN)
    if planner is None:
        connection.send_error(msg['id'], 'not_loaded', 'Essensplan ist nicht geladen')
        return

    @callback
    def forward():
        connection.send_message(websocket_api.event_message(msg['id'], {
            'revision': planner.state['revision'], 'today': dt_util.now().date().isoformat()}))

    connection.subscriptions[msg['id']] = planner.subscribe(forward)
    connection.send_result(msg['id'])
