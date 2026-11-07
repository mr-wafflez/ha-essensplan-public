"""Home Assistant to-do adapter and lifecycle for optional shopping-list sync."""
import asyncio
from copy import deepcopy
from datetime import timedelta
import logging

from homeassistant.components.todo import TodoListEntityFeature
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import async_call_later, async_track_state_change_event, async_track_time_interval
from homeassistant.helpers.start import async_at_started
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import CONF_SYNC_ENABLED, CONF_SYNC_TARGET, DOMAIN
from .sync_engine import SyncEngine, SyncError

_LOGGER = logging.getLogger(__name__)
REQUIRED_FEATURES = int(TodoListEntityFeature.CREATE_TODO_ITEM | TodoListEntityFeature.DELETE_TODO_ITEM | TodoListEntityFeature.UPDATE_TODO_ITEM)


def valid_target(hass, entity_id, entry_id):
    if not isinstance(entity_id, str) or not entity_id.startswith('todo.'):
        return False
    registered = er.async_get(hass).async_get(entity_id)
    if registered is not None and registered.config_entry_id == entry_id:
        return False
    state = hass.states.get(entity_id)
    return state is not None and int(state.attributes.get('supported_features', 0)) & REQUIRED_FEATURES == REQUIRED_FEATURES


class TodoClient:
    def __init__(self, hass, target, entry_id):
        self.hass, self.target, self.entry_id = hass, target, entry_id

    def marker(self, uid):
        state = self.hass.states.get(self.target)
        if state and int(state.attributes.get('supported_features', 0)) & TodoListEntityFeature.SET_DESCRIPTION_ON_ITEM:
            return f'Essensplan [{self.entry_id}:{uid}]'
        return None

    async def read(self):
        state = self.hass.states.get(self.target)
        if state is None or state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
            raise SyncError('target_unavailable')
        if not valid_target(self.hass, self.target, self.entry_id):
            raise SyncError('unsupported_target')
        response = await self.hass.services.async_call('todo', 'get_items',
            {'entity_id': self.target}, blocking=True, return_response=True)
        if not isinstance(response, dict) or not isinstance(response.get(self.target), dict):
            raise SyncError('invalid_target_response')
        return response[self.target].get('items')

    async def add(self, summary, marker):
        data = {'item': summary}
        if marker:
            data['description'] = marker
        await self._write('add_item', data)

    async def update(self, uid, changes):
        await self._write('update_item', {'item': uid, **changes})

    async def remove(self, uid):
        await self._write('remove_item', {'item': [uid]})

    async def _write(self, service, data):
        state = self.hass.states.get(self.target)
        if state is None or state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
            raise SyncError('target_unavailable')
        await self.hass.services.async_call('todo', service,
            {'entity_id': self.target, **data}, blocking=True)


class ShoppingSync:
    def __init__(self, hass, entry, planner):
        self.hass, self.entry, self.planner = hass, entry, planner
        self.target = entry.options.get(CONF_SYNC_TARGET)
        # Existing 0.4.0 targets remain active; new installations default to off.
        self.enabled = entry.options.get(CONF_SYNC_ENABLED, bool(self.target))
        self.store = Store(hass, 1, f'{DOMAIN}_sync.{entry.entry_id}')
        self.data = {'targets': {}}
        self.engine = None
        self.state = 'waiting' if self.enabled and self.target else 'disabled'
        self.last_success = None
        self.error = None
        self.listeners = set()
        self._unsubscribers = []
        self._timer = None
        self._task = None
        self._stopped = False

    def subscribe(self, listener):
        self.listeners.add(listener)
        return lambda: self.listeners.discard(listener)

    @callback
    def _notify(self):
        for listener in tuple(self.listeners):
            listener()

    async def start(self):
        if not self.enabled or not self.target:
            return
        try:
            loaded = await self.store.async_load()
            self.data = {'targets': {}} if loaded is None else loaded
            if not isinstance(self.data, dict) or not isinstance(self.data.get('targets'), dict):
                raise SyncError('invalid_journal')
            if self.target in self.data['targets'] and not isinstance(self.data['targets'][self.target], dict):
                raise SyncError('invalid_journal')
            async def complete(uid, completed, revision):
                await self.planner.change('complete', {'uid': uid, 'completed': completed}, revision)
            async def save(state):
                data = deepcopy(self.data)
                data['targets'][self.target] = state
                await self.store.async_save(data)
                self.data = data
            self.engine = SyncEngine(self.planner.snapshot, complete,
                TodoClient(self.hass, self.target, self.entry.entry_id), save,
                self.data['targets'].get(self.target))
        except (OSError, ValueError, HomeAssistantError, SyncError):
            self.state, self.error = 'error', 'invalid_journal'
            self._notify()
            return
        self._unsubscribers.extend([
            self.planner.subscribe(self.request),
            async_track_state_change_event(self.hass, [self.target], self.request),
            async_track_time_interval(self.hass, self.request, timedelta(seconds=30)),
            async_at_started(self.hass, self.request),
        ])

    @callback
    def request(self, *_):
        if self._stopped or self._timer is not None or not self.engine:
            return
        self._timer = async_call_later(self.hass, 1, self._launch)

    @callback
    def _launch(self, *_):
        self._timer = None
        if self._stopped:
            return
        if self._task is not None and not self._task.done():
            self.request()
            return
        self._task = self.hass.async_create_background_task(self.run(), 'Essensplan shopping-list sync')

    async def run(self):
        self.state = 'syncing'
        self._notify()
        try:
            async with asyncio.timeout(45):
                await self.engine.run()
        except (HomeAssistantError, SyncError, OSError, ValueError, TimeoutError) as err:
            error = str(err) if isinstance(err, SyncError) else 'sync_failed'
            if self.error != error:
                _LOGGER.warning('Shopping-list sync to %s paused (%s)', self.target, error)
            self.state, self.error = 'error', error
        else:
            self.state, self.error = 'idle', None
            self.last_success = dt_util.utcnow().isoformat()
        self._notify()

    async def sync_now(self, retry_unconfirmed=False):
        if not self.enabled:
            raise HomeAssistantError('Die Synchronisation ist ausgeschaltet. Aktiviere „Einkaufsliste synchronisieren“ in den Essensplan-Einstellungen.')
        if self._stopped or not self.engine:
            raise HomeAssistantError('Wähle zuerst eine Ziel-Einkaufsliste in den Essensplan-Einstellungen.')
        if self._task is not None and not self._task.done():
            raise HomeAssistantError('Die Synchronisation läuft bereits. Bitte kurz warten.')
        if self._timer is not None:
            self._timer()
            self._timer = None
        async def run_requested():
            if retry_unconfirmed:
                try:
                    await self.engine.retry_unconfirmed()
                except SyncError as err:
                    raise HomeAssistantError(f'Die Übertragung ist noch nicht eindeutig: {err}') from err
            await self.run()
        self._task = self.hass.async_create_background_task(run_requested(), 'Essensplan requested shopping sync')
        await self._task

    async def stop(self):
        self._stopped = True
        if self._timer is not None:
            self._timer()
            self._timer = None
        for unsubscribe in self._unsubscribers:
            unsubscribe()
        self._unsubscribers.clear()
        if self._task is not None and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
