"""Lifecycle and migration tests against the HA frontend API boundary."""
import asyncio
from copy import deepcopy
from dataclasses import dataclass
import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import AsyncMock, patch

ROOT = Path(__file__).parents[1]
COMPONENT = ROOT / 'custom_components' / 'essensplan'


def load_frontend():
    modules = {name: types.ModuleType(name) for name in [
        'homeassistant', 'homeassistant.components',
        'homeassistant.components.frontend', 'homeassistant.components.panel_custom',
        'homeassistant.components.http', 'homeassistant.components.lovelace',
        'homeassistant.components.lovelace.const', 'homeassistant.exceptions',
        'essensplan_frontend_test',
    ]}
    modules['essensplan_frontend_test'].__path__ = [str(COMPONENT)]
    frontend = modules['homeassistant.components.frontend']
    frontend.DATA_PANELS = 'frontend_panels'
    frontend.add_extra_js_url = lambda hass, url: hass.modules.add(url)
    frontend.async_remove_panel = lambda hass, path: hass.data['frontend_panels'].pop(path)
    panel = modules['homeassistant.components.panel_custom']

    async def register(hass, **kwargs):
        hass.data['frontend_panels'][kwargs['frontend_url_path']] = kwargs
    panel.async_register_panel = AsyncMock(side_effect=register)

    @dataclass
    class StaticPathConfig:
        url_path: str
        path: str
        cache_headers: bool
    modules['homeassistant.components.http'].StaticPathConfig = StaticPathConfig
    modules['homeassistant.components.lovelace'].LOVELACE_DATA = 'lovelace'
    modules['homeassistant.components.lovelace.const'].CONF_RESOURCE_TYPE_WS = 'res_type'
    modules['homeassistant.exceptions'].HomeAssistantError = RuntimeError
    name = 'essensplan_frontend_test.frontend'
    spec = importlib.util.spec_from_file_location(name, COMPONENT / 'frontend.py')
    module = importlib.util.module_from_spec(spec)
    modules[name] = module
    with patch.dict(sys.modules, modules):
        spec.loader.exec_module(module)
    return module, panel


class Resources:
    def __init__(self, items=()):
        self.items = deepcopy(list(items))
        self.loaded = False
        self.updated = []
        self.deleted = []

    async def async_get_info(self):
        self.loaded = True
        return {'resources': len(self.items)}

    def async_items(self):
        assert self.loaded, 'Resources must be loaded before inspecting them'
        return deepcopy(self.items)

    async def async_update_item(self, item_id, updates):
        assert self.loaded
        self.updated.append(item_id)
        for item in self.items:
            if item['id'] == item_id:
                item.update({'url': updates['url'], 'type': updates['res_type']})

    async def async_delete_item(self, item_id):
        self.deleted.append(item_id)
        self.items = [item for item in self.items if item['id'] != item_id]


class FrontendTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.module, self.panel = load_frontend()
        self.resources = Resources()
        self.hass = types.SimpleNamespace(
            data={'lovelace': types.SimpleNamespace(resources=self.resources, dashboards={}), 'frontend_panels': {}},
            http=types.SimpleNamespace(async_register_static_paths=AsyncMock()),
            modules=set(),
        )

    async def test_new_install_serves_complete_bundle_and_ready_sidebar(self):
        await self.module.async_setup_frontend_entry(self.hass)
        self.assertEqual(self.hass.modules, {self.module.CARD_URL})
        path = self.hass.http.async_register_static_paths.call_args.args[0][0]
        self.assertEqual(path.url_path, '/essensplan_static')
        self.assertTrue((Path(path.path) / 'essensplan-card.js').is_file())
        self.assertTrue((Path(path.path) / 'essensplan-panel.js').is_file())
        panel = self.hass.data['frontend_panels']['essensplan']
        self.assertEqual(panel['webcomponent_name'], 'essensplan-panel')
        self.assertFalse(panel['embed_iframe'])
        self.assertFalse(panel['require_admin'])
        self.assertTrue(self.resources.loaded)
        self.assertEqual(self.resources.items, [])  # No manual Lovelace resource needed.

    async def test_existing_nested_dashboard_and_unrelated_resources_are_preserved(self):
        other = {'id': 'other', 'url': '/hacsfiles/other.js', 'type': 'module'}
        self.resources.items = [other.copy(), {'id': 'meal', 'url': '/local/essensplan-card.js?v=0.2.0', 'type': 'module'}]
        config = {'views': [{'sections': [{'cards': [{'type': 'custom:essensplan-card', 'mode': 'week'}]}]}]}
        board = types.SimpleNamespace(async_load=AsyncMock(return_value=deepcopy(config)))
        self.hass.data['lovelace'].dashboards['essensplan-plan'] = board
        await self.module.async_setup_frontend_entry(self.hass)
        self.assertEqual(self.resources.items[0], other)
        self.assertEqual(self.resources.items[1], {'id': 'meal', 'url': self.module.CARD_URL, 'type': 'module'})
        self.assertEqual(board.async_load.return_value, config)
        self.panel.async_register_panel.assert_not_awaited()

    async def test_only_owned_duplicates_are_removed(self):
        external = {'id': 'external', 'url': 'https://example.com/local/essensplan-card.js', 'type': 'module'}
        self.resources.items = [
            {'id': 'old', 'url': '/local/essensplan-card.js?v=1', 'type': 'js'},
            external.copy(),
            {'id': 'duplicate', 'url': self.module.CARD_URL, 'type': 'module'},
        ]
        await self.module.async_setup_frontend_entry(self.hass)
        self.assertEqual(self.resources.deleted, ['duplicate'])
        self.assertIn(external, self.resources.items)
        self.assertEqual(self.resources.items[0]['type'], 'module')

    async def test_registration_is_idempotent(self):
        await self.module.async_setup_frontend_entry(self.hass)
        await self.module.async_setup_frontend_entry(self.hass)
        self.hass.http.async_register_static_paths.assert_awaited_once()
        self.panel.async_register_panel.assert_awaited_once()

    async def test_unload_reload_removes_only_the_managed_panel(self):
        self.hass.data['frontend_panels']['another-panel'] = {'title': 'Keep'}
        await self.module.async_setup_frontend_entry(self.hass)
        self.module.async_unload_frontend_entry(self.hass)
        self.assertEqual(self.hass.data['frontend_panels'], {'another-panel': {'title': 'Keep'}})
        self.assertEqual(self.hass.modules, {self.module.CARD_URL})
        await self.module.async_setup_frontend_entry(self.hass)
        self.hass.http.async_register_static_paths.assert_awaited_once()
        self.assertIn('essensplan', self.hass.data['frontend_panels'])

    async def test_unload_preserves_user_dashboard_panel(self):
        self.hass.data['frontend_panels']['essensplan-plan'] = {'title': 'Essensplan'}
        self.hass.data['lovelace'].dashboards['essensplan-plan'] = types.SimpleNamespace(
            async_load=AsyncMock(return_value={'views': [{'cards': [{'type': 'custom:essensplan-card'}]}]}),
        )
        await self.module.async_setup_frontend_entry(self.hass)
        self.module.async_unload_frontend_entry(self.hass)
        self.assertEqual(self.hass.data['frontend_panels']['essensplan-plan'], {'title': 'Essensplan'})

    async def test_conflicting_panel_url_is_never_overwritten(self):
        self.hass.data['frontend_panels']['essensplan'] = {'title': 'Existing user panel'}
        await self.module.async_setup_frontend_entry(self.hass)
        self.assertEqual(self.hass.data['frontend_panels']['essensplan'], {'title': 'Existing user panel'})
        self.assertIn('essensplan-2', self.hass.data['frontend_panels'])

    async def test_unsaved_default_dashboard_does_not_block_setup(self):
        self.hass.data['lovelace'].dashboards[None] = types.SimpleNamespace(
            async_load=AsyncMock(side_effect=RuntimeError('No saved dashboard')),
        )
        await self.module.async_setup_frontend_entry(self.hass)
        self.assertIn('essensplan', self.hass.data['frontend_panels'])

    async def test_yaml_resources_use_automatic_module_without_writing_yaml(self):
        items = [{'url': '/local/essensplan-card.js', 'type': 'module'}]
        resources = types.SimpleNamespace(
            async_get_info=AsyncMock(return_value={'resources': 1}),
            async_items=lambda: deepcopy(items),
        )
        self.hass.data['lovelace'].resources = resources
        await self.module.async_setup_frontend_entry(self.hass)
        self.assertEqual(items, [{'url': '/local/essensplan-card.js', 'type': 'module'}])
        self.assertIn(self.module.CARD_URL, self.hass.modules)

    def test_release_assets_share_the_manifest_version(self):
        version = json.loads((COMPONENT / 'manifest.json').read_text())['version']
        self.assertEqual(version, self.module.VERSION)
        panel = (COMPONENT / 'frontend' / 'essensplan-panel.js').read_text()
        self.assertIn(f"import './essensplan-card.js?v={version}'", panel)


if __name__ == '__main__':
    unittest.main()
