"""Exercise the actual HA todo services and options flow in a temporary HA instance.

Run inside the HA Python environment with the staged component path. This never
connects to the running HA process or reads its recipes, lists, or credentials.
"""
import asyncio
from dataclasses import replace
from copy import deepcopy
import importlib.util
import logging
from pathlib import Path
import tempfile
import types
import sys
from uuid import uuid4

from homeassistant.config_entries import ConfigEntries
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.components.todo import TodoItem, TodoItemStatus, TodoListEntity, TodoListEntityFeature
from homeassistant.components.todo.const import DATA_COMPONENT
from homeassistant.components.todo.services import async_setup_services
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.entity_component import EntityComponent
from homeassistant.util import dt as dt_util


def load(component, name, filename):
    spec = importlib.util.spec_from_file_location(name, component / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class MemoryList(TodoListEntity):
    _attr_should_poll = False
    _attr_name = 'Essensplan runtime target'
    _attr_unique_id = 'essensplan_runtime_target'
    _attr_supported_features = (TodoListEntityFeature.CREATE_TODO_ITEM | TodoListEntityFeature.DELETE_TODO_ITEM
        | TodoListEntityFeature.UPDATE_TODO_ITEM | TodoListEntityFeature.SET_DESCRIPTION_ON_ITEM)

    def __init__(self):
        self.items = [TodoItem(uid='manual', summary='Manueller Testartikel', status=TodoItemStatus.NEEDS_ACTION)]

    @property
    def todo_items(self):
        return self.items

    async def async_create_todo_item(self, item):
        self.items.append(replace(item, uid=uuid4().hex))
        self.async_write_ha_state()

    async def async_update_todo_item(self, item):
        self.items = [item if old.uid == item.uid else old for old in self.items]
        self.async_write_ha_state()

    async def async_delete_todo_items(self, uids):
        self.items = [item for item in self.items if item.uid not in uids]
        self.async_write_ha_state()


async def verify(component):
    package = types.ModuleType('essensplan_sync_runtime')
    package.__path__ = [str(component)]
    sys.modules[package.__name__] = package
    integration = load(component, package.__name__ + '.integration', '__init__.py')
    flow_module = load(component, package.__name__ + '.config_flow', 'config_flow.py')
    from essensplan_sync_runtime.sync import ShoppingSync, valid_target

    with tempfile.TemporaryDirectory(prefix='essensplan-sync-runtime-') as directory:
        hass = HomeAssistant(directory)
        hass.config_entries = ConfigEntries(hass, {})
        await hass.config_entries.async_initialize()
        dr.async_setup(hass)
        await dr.async_load(hass)
        await er.async_load(hass)
        entities = EntityComponent(logging.getLogger('essensplan_runtime'), 'todo', hass)
        hass.data[DATA_COMPONENT] = entities
        async_setup_services(hass)
        target = MemoryList()
        await entities.async_add_entities([target])
        target_id = target.entity_id
        entry = types.SimpleNamespace(entry_id='isolated-runtime-check', options={'sync_target': target_id})
        assert valid_target(hass, target_id, entry.entry_id)
        assert not valid_target(hass, 'sensor.unknown', entry.entry_id)
        planner = integration.Planner(hass)
        await planner.change('save_recipe', {'name': 'Testrezept', 'servings': 4,
            'ingredients': [{'name': 'Kartoffeln', 'quantity': 500, 'unit': 'g'}], 'steps': ['Test']})
        rid = next(iter(planner.state['recipes']))
        today = dt_util.now().date().isoformat()
        await planner.change('set_meal', {'date': today, 'recipe_id': rid, 'servings': 4})

        manager = ShoppingSync(hass, entry, planner)
        # Exercise passes deterministically; no timers race the service assertions.
        manager.request = lambda *_: None
        await manager.start()
        await manager.run()
        assert manager.state == 'idle', manager.error
        assert len(target.items) == 2
        generated = next(item for item in target.items if item.uid != 'manual')
        assert generated.summary == '500 g Kartoffeln'
        await manager.run()
        assert len(target.items) == 2
        await manager.sync_now()
        assert manager.state == 'idle'

        await hass.services.async_call('todo', 'update_item', {'entity_id': target_id,
            'item': generated.uid, 'status': 'completed'}, blocking=True)
        await manager.run()
        assert planner.snapshot()['shopping'][0]['completed']
        uid = planner.snapshot()['shopping'][0]['uid']
        await planner.change('complete', {'uid': uid, 'completed': False})
        await manager.run()
        assert next(item for item in target.items if item.uid == generated.uid).status == 'needs_action'
        await planner.change('set_meal', {'date': today, 'recipe_id': rid, 'servings': 8})
        await manager.run()
        assert len(target.items) == 2 and any(item.summary == '1000 g Kartoffeln' for item in target.items)
        assert any(item.uid == 'manual' for item in target.items)
        await manager.stop()
        reloaded = ShoppingSync(hass, entry, planner)
        reloaded.request = lambda *_: None
        await reloaded.start()
        await reloaded.run()
        assert reloaded.state == 'idle', reloaded.error
        assert len(target.items) == 2
        hass.states.async_set(target_id, 'unavailable', {'supported_features': int(target.supported_features)})
        await reloaded.run()
        assert reloaded.state == 'error' and reloaded.error == 'target_unavailable'
        assert len(target.items) == 2
        target.async_write_ha_state()
        await reloaded.run()
        assert reloaded.state == 'idle'
        await reloaded.stop()

        disabled_manager = ShoppingSync(hass, types.SimpleNamespace(entry_id=entry.entry_id, options={}), planner)
        await disabled_manager.start()
        assert disabled_manager.state == 'disabled' and disabled_manager.engine is None
        await disabled_manager.stop()

        paused_entry = types.SimpleNamespace(entry_id=entry.entry_id,
            options={'sync_target': target_id, 'sync_enabled': False})
        uid = planner.snapshot()['shopping'][0]['uid']
        generated = next(item for item in target.items if item.uid != 'manual')
        paused = ShoppingSync(hass, paused_entry, planner)
        items_before_pause = deepcopy(target.items)
        journal_before_pause = await paused.store.async_load()
        await paused.start()
        assert paused.state == 'disabled' and paused.target == target_id and not paused.enabled
        assert paused.engine is None and not paused._unsubscribers
        for retry in (False, True):
            try:
                await paused.sync_now(retry_unconfirmed=retry)
            except HomeAssistantError as error:
                assert 'ausgeschaltet' in str(error)
            else:
                raise AssertionError('Manual sync must not bypass the disabled flag')
        await planner.change('complete', {'uid': uid, 'completed': True})
        await hass.async_block_till_done()
        assert target.items == items_before_pause
        assert await paused.store.async_load() == journal_before_pause
        assert paused._timer is None and paused._task is None
        await paused.stop()
        resumed_entry = types.SimpleNamespace(entry_id=entry.entry_id,
            options={'sync_target': target_id, 'sync_enabled': True})
        resumed = ShoppingSync(hass, resumed_entry, planner)
        resumed.request = lambda *_: None
        await resumed.start()
        await resumed.run()
        assert resumed.state == 'idle' and resumed.enabled
        assert next(item for item in target.items if item.uid == generated.uid).status == 'completed'
        await planner.change('complete', {'uid': uid, 'completed': False})
        await resumed.run()
        assert target.items == items_before_pause
        await resumed.stop()

        await reloaded.store.async_save({'targets': {target_id: None}})
        corrupt = ShoppingSync(hass, entry, planner)
        await corrupt.start()
        assert corrupt.state == 'error' and corrupt.error == 'invalid_journal'
        assert len(planner.snapshot()['shopping']) == 1
        await corrupt.stop()

        # Multiple dishes use real HA storage, sensor attributes and sync services.
        sensor_module = load(component, package.__name__ + '.sensor', 'sensor.py')
        planner.meals_per_day = 2
        await planner.change('set_meal', {'date': today, 'slot': 1, 'recipe_id': rid, 'servings': 4})
        assert planner.snapshot()['shopping'][0]['summary'] == '1500 g Kartoffeln'
        meal_sensor = sensor_module.MealSensor(planner)
        assert meal_sensor.native_value == 'Testrezept · Testrezept'
        assert [m['servings'] for m in meal_sensor.extra_state_attributes['meals']] == ['8', '4']
        reloaded_planner = integration.Planner(hass, 1)
        reloaded_planner.state = integration.normalize_state(await reloaded_planner.store.async_load())
        assert reloaded_planner.snapshot()['shopping'] == planner.snapshot()['shopping']
        assert len(reloaded_planner.state['plan'][today]) == 2
        before = planner.snapshot()
        real_save = planner.store.async_save
        async def failed_save(_):
            raise OSError('Disk full')
        planner.store.async_save = failed_save
        try:
            await planner.change('set_meal', {'date': today, 'slot': 1, 'recipe_id': None})
        except OSError:
            pass
        else:
            raise AssertionError('A failed save must be reported')
        assert planner.snapshot() == before
        planner.store.async_save = real_save
        try:
            await planner.change('set_meal', {'date': today, 'slot': 1, 'recipe_id': None}, before['revision']-1)
        except ValueError:
            pass
        else:
            raise AssertionError('Stale revisions must be rejected')
        assert planner.snapshot() == before
        # Restore the valid test journal and verify the combined ingredients export once.
        await reloaded.store.async_save(journal_before_pause)
        multi_sync = ShoppingSync(hass, entry, planner)
        multi_sync.request = lambda *_: None
        await multi_sync.start()
        await multi_sync.run()
        assert multi_sync.state == 'idle', multi_sync.error
        assert len(target.items) == 2 and any(item.summary == '1500 g Kartoffeln' for item in target.items)
        await planner.change('set_meal', {'date': today, 'recipe_id': None})
        assert meal_sensor.extra_state_attributes['recipe_id'] == rid
        assert meal_sensor.extra_state_attributes['meals'][0]['slot'] == 1
        await multi_sync.run()
        assert any(item.summary == '500 g Kartoffeln' for item in target.items)
        await multi_sync.stop()

        class OptionsFlow(flow_module.EssensplanOptionsFlow):
            @property
            def config_entry(self):
                return entry
        flow = OptionsFlow()
        flow.hass = hass
        form = await flow.async_step_init()
        assert form['type'] == 'form' and form['data_schema']({})['sync_enabled'] is True
        selected = await flow.async_step_init({'sync_enabled': True, 'sync_target': target_id})
        assert selected['type'] == 'create_entry' and selected['data'] == {'sync_enabled': True, 'sync_target': target_id, 'meals_per_day': 1}
        rejected = await flow.async_step_init({'sync_enabled': True, 'sync_target': 'sensor.missing'})
        assert rejected['errors']['sync_target'] == 'unsupported_target'
        missing = await flow.async_step_init({'sync_enabled': True, 'sync_target': None})
        assert missing['errors']['sync_target'] == 'missing_target'
        disabled = await flow.async_step_init({'sync_enabled': False})
        assert disabled['type'] == 'create_entry' and disabled['data'] == {'sync_enabled': False, 'sync_target': target_id, 'meals_per_day': 1}
        entry.options = disabled['data']
        disabled_form = await flow.async_step_init()
        assert disabled_form['data_schema']({})['sync_enabled'] is False
        reenabled = await flow.async_step_init({'sync_enabled': True})
        assert reenabled['data'] == {'sync_enabled': True, 'sync_target': target_id, 'meals_per_day': 1}
        hass.states.async_set(target_id, 'unavailable', {'supported_features': 0})
        paused_unavailable = await flow.async_step_init({'sync_enabled': False})
        assert paused_unavailable['data'] == disabled['data']
        enabled_unavailable = await flow.async_step_init({'sync_enabled': True})
        assert enabled_unavailable['errors']['sync_target'] == 'unsupported_target'
        target.async_write_ha_state()
        cleared = await flow.async_step_init({'sync_enabled': False, 'sync_target': None})
        assert cleared['data'] == {'sync_enabled': False, 'meals_per_day': 1}
        entry.options = {}
        new_form = await flow.async_step_init()
        assert new_form['data_schema']({})['sync_enabled'] is False
        new_disabled = await flow.async_step_init({'sync_enabled': False})
        assert new_disabled['data'] == {'sync_enabled': False, 'meals_per_day': 1}
        assert new_form['data_schema']({})['meals_per_day'] == 1
        assert new_form['data_schema']({'meals_per_day': 6})['meals_per_day'] == 6
        for count in [0, 7, 1.5, True, '2', None, float('nan'), float('inf')]:
            invalid_count = await flow.async_step_init({'meals_per_day': count})
            assert invalid_count['errors']['meals_per_day'] == 'invalid_meals_per_day'
        chosen = await flow.async_step_init({'meals_per_day': 2.0})
        assert chosen['data'] == {'sync_enabled': False, 'meals_per_day': 2}
        assert type(chosen['data']['meals_per_day']) is int
        entry.options = {'sync_target': target_id, 'sync_enabled': True, 'meals_per_day': 3}
        retained_count = await flow.async_step_init({'sync_enabled': False})
        assert retained_count['data']['meals_per_day'] == 3 and retained_count['data']['sync_target'] == target_id
        await target.async_remove()
        await hass.async_block_till_done()
        print('PASS: real HA todo services, sync checks and failures; multiple dishes, combined ingredient export, storage/reload, sensor slots, failed save atomicity, stale revisions, real number options selector and validation, retained count/target and sync toggle behavior')


if __name__ == '__main__':
    asyncio.run(verify(Path(sys.argv[1])))
