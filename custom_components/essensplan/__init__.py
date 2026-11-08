"""Local meal planner with recipes and a generated native shopping list."""
import asyncio
from copy import deepcopy
import logging

from .compat import vol
from homeassistant.components import websocket_api
from homeassistant.core import callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.event import async_track_time_change
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import CONF_MEALS_PER_DAY, DEFAULT_MEALS_PER_DAY, DOMAIN, PLATFORMS
from .model import initial_state, mutate, normalize_state, shopping
from .frontend import async_register_frontend, async_setup_frontend_entry, async_unload_frontend_entry
from .sync import ShoppingSync

_LOGGER = logging.getLogger(__name__)


class Planner:
    def __init__(self, hass, meals_per_day=DEFAULT_MEALS_PER_DAY):
        self.hass = hass
        self.meals_per_day = meals_per_day
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
        result['today'] = dt_util.now().date().isoformat()
        result['shopping'] = shopping(self.state, result['today'])
        return result

    async def change(self, operation, payload, revision=None):
        async with self.lock:
            if revision is not None and revision != self.state['revision']:
                raise ValueError('Daten wurden inzwischen geändert. Bitte neu laden und erneut versuchen.')
            new = mutate(self.state, operation, payload, dt_util.now().date().isoformat(), self.meals_per_day)
            await self.store.async_save(new)
            self.state = new
            self.notify()
            return self.snapshot()


async def async_setup(hass, config):
    await async_register_frontend(hass)
    websocket_api.async_register_command(hass, ws_get)
    websocket_api.async_register_command(hass, ws_change)
    async def sync_shopping_list(call):
        planner = hass.data.get(DOMAIN)
        if planner is None:
            raise HomeAssistantError('Essensplan ist nicht geladen')
        await planner.sync.sync_now(call.data['retry_unconfirmed'])
    hass.services.async_register(DOMAIN, 'sync_shopping_list', sync_shopping_list,
        schema=vol.Schema({vol.Optional('retry_unconfirmed', default=False): bool}))
    return True


async def async_setup_entry(hass, entry):
    planner = Planner(hass, entry.options.get(CONF_MEALS_PER_DAY, DEFAULT_MEALS_PER_DAY))
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
    vol.Required('operation'): vol.In(['save_recipe', 'delete_recipe', 'set_meal', 'shopping_week', 'complete', 'favorite', 'shopping_amount', 'mark_cooked']),
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
