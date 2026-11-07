"""Run in an HA Python environment, separately from the running HA process."""
import asyncio
from copy import deepcopy
import importlib.util
from pathlib import Path
import sys
import tempfile
import types

from homeassistant.core import HomeAssistant
from homeassistant.components import frontend
from homeassistant.components.lovelace import LOVELACE_DATA


async def verify(component):
    package = types.ModuleType('essensplan_runtime_check')
    package.__path__ = [str(component)]
    sys.modules[package.__name__] = package
    name = package.__name__ + '.frontend'
    spec = importlib.util.spec_from_file_location(name, component / 'frontend.py')
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)

    class Resources:
        def __init__(self):
            self.loaded = False
        async def async_get_info(self):
            self.loaded = True
            return {'resources': 0}
        def async_items(self):
            assert self.loaded
            return []

    with tempfile.TemporaryDirectory(prefix='essensplan-ha-runtime-') as directory:
        hass = HomeAssistant(directory)
        static_paths = []
        async def register(paths):
            for path in paths:
                assert Path(path.path).is_dir()
                static_paths.append(path.url_path)
        hass.http = types.SimpleNamespace(async_register_static_paths=register)
        hass.data[frontend.DATA_PANELS] = {}
        hass.data[frontend.DATA_EXTRA_MODULE_URL] = set()
        hass.data[LOVELACE_DATA] = types.SimpleNamespace(resources=Resources(), dashboards={})
        await module.async_setup_frontend_entry(hass)
        assert 'essensplan' in hass.data[frontend.DATA_PANELS]
        assert module.CARD_URL in hass.data[frontend.DATA_EXTRA_MODULE_URL]
        await module.async_setup_frontend_entry(hass)
        assert static_paths == ['/essensplan_static']
        module.async_unload_frontend_entry(hass)
        assert 'essensplan' not in hass.data[frontend.DATA_PANELS]
        dashboard = {'views': [{'cards': [{'type':'custom:essensplan-card'}]}]}
        class Dashboard:
            async def async_load(self, _force):
                return deepcopy(dashboard)
        hass.data[LOVELACE_DATA].dashboards = {'essensplan-plan': Dashboard()}
        await module.async_setup_frontend_entry(hass)
        assert not hass.data[frontend.DATA_PANELS]
        await hass.async_block_till_done()
        print('PASS: real HA frontend/panel APIs, fresh setup, idempotence, unload and existing dashboard reuse')


if __name__ == '__main__':
    asyncio.run(verify(Path(sys.argv[1])))
