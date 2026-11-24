"""Call the card's WebSocket commands through Home Assistant's real connection class.

Run inside the HA Python environment with the component path, e.g.
python tests/ha_runtime_websocket.py custom_components/essensplan
It uses a temporary configuration folder and never touches a running HA instance.
"""
import asyncio
import importlib.util
import json
import logging
from pathlib import Path
import sys
import tempfile
import types
from unittest.mock import MagicMock

from homeassistant.components import websocket_api
from homeassistant.components.websocket_api.connection import ActiveConnection
from homeassistant.core import HomeAssistant


def load(component, name, filename):
    spec = importlib.util.spec_from_file_location(name, component / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


async def verify(component):
    package = types.ModuleType('essensplan_ws_runtime')
    package.__path__ = [str(component)]
    sys.modules[package.__name__] = package
    integration = load(component, package.__name__ + '.integration', '__init__.py')

    with tempfile.TemporaryDirectory(prefix='essensplan-ws-runtime-') as directory:
        hass = HomeAssistant(directory)
        for command in (integration.ws_get, integration.ws_change, integration.ws_ingredients,
                        integration.ws_subscribe, integration.ws_product_contribute):
            websocket_api.async_register_command(hass, command)
        planner = integration.Planner(hass, nutrition_enabled=True)
        hass.data[integration.DOMAIN] = planner
        products = load(component, package.__name__ + '.products', 'products.py')
        planner.products = products.ProductLookup(None)
        await planner.change('save_recipe', {'name': 'Linsensuppe', 'servings': 4, 'steps': ['Kochen.'],
            'ingredients': [{'name': 'rote Linsen', 'quantity': '250', 'unit': 'g'},
                            {'name': 'Zwiebel', 'quantity': '', 'unit': ''},
                            {'name': 'Salz', 'quantity': '', 'unit': ''}]})
        rid = next(iter(planner.state['recipes']))

        sent = []
        user = MagicMock(is_admin=False, id='runtime-user')

        def open_connection():
            return ActiveConnection(logging.getLogger('essensplan_ws_runtime'), hass,
                                    lambda message: sent.append(message), user, MagicMock(), '127.0.0.1')
        connection = open_connection()

        def results(message_id):
            messages = [m if isinstance(m, dict) else json.loads(m) for m in sent]
            return [m for m in messages if m.get('id') == message_id]

        async def call(message_id, payload):
            connection.async_handle({'id': message_id, **payload})
            # Some commands run in the executor; wait up to five seconds for the answer.
            for _ in range(250):
                await asyncio.sleep(0.02)
                await hass.async_block_till_done()
                if results(message_id):
                    break
            return results(message_id)

        # Snapshot: compact nutrition, no ingredient list.
        [got] = await call(1, {'type': 'essensplan/get'})
        assert got['success'], got
        snapshot = got['result']
        assert 'ingredient_list' not in snapshot
        summary = snapshot['nutrition'][rid]
        assert set(summary) == {'total', 'portion', 'used', 'open'}, summary
        assert summary['open'] == {'mapping': ['rote Linsen', 'Zwiebel']}, summary

        # The ingredient list comes on request, with the revision it belongs to.
        [got] = await call(2, {'type': 'essensplan/ingredients'})
        assert got['success'], got
        names = {entry['name']: entry for entry in got['result']['ingredient_list']}
        assert got['result']['revision'] == planner.state['revision']
        assert names['Salz']['status'] == 'ignored' and names['Zwiebel']['status'] == 'open'

        # Subscribers hear about every change, and unsubscribe when the connection closes.
        [got] = await call(3, {'type': 'essensplan/subscribe'})
        assert got['success'], got
        before = planner.state['revision']
        [got] = await call(4, {'type': 'essensplan/change', 'operation': 'favorite', 'revision': before,
                               'payload': {'id': rid, 'favorite': True}})
        assert got['success'], got
        events = [m for m in results(3) if m.get('type') == 'event']
        assert events and events[-1]['event']['revision'] == before + 1, events
        assert len(planner.listeners) == 1
        connection.async_handle_close()
        assert not planner.listeners

        # Contributing needs explicit consent and a configured account; nothing is sent otherwise.
        connection = open_connection()
        assert planner.snapshot()['modules']['contribute'] is False
        package_data = {'barcode': '4000000000013', 'name': 'Test', 'values': {'kcal': 1, 'protein': 1, 'carbs': 1, 'fat': 1}}
        [got] = await call(6, {'type': 'essensplan/product_contribute', 'consent': False, 'product': package_data})
        assert not got['success'] and got['error']['code'] == 'invalid_format', got
        [got] = await call(7, {'type': 'essensplan/product_contribute', 'consent': True, 'product': package_data})
        assert not got['success'] and got['error']['code'] == 'contribute_failed' and 'Konto' in got['error']['message'], got

        # With the module off, the ingredient list is refused instead of computed.
        planner.nutrition_enabled = False
        connection = open_connection()
        [got] = await call(5, {'type': 'essensplan/ingredients'})
        assert not got['success'] and got['error']['code'] == 'not_enabled', got
        await hass.async_stop(force=True)
    print('PASS: real HA WebSocket connection, compact snapshot, ingredient list on request, '
          'change events to subscribers, unsubscribe on close, contribution needs consent and account, '
          'disabled module refused')


if __name__ == '__main__':
    asyncio.run(verify(Path(sys.argv[1])))
