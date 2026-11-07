"""Serve the bundled card and make a fresh installation usable immediately."""
from dataclasses import dataclass
import logging
from pathlib import Path
from urllib.parse import urlsplit

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.components.lovelace import LOVELACE_DATA
from homeassistant.components.lovelace.const import CONF_RESOURCE_TYPE_WS
from homeassistant.exceptions import HomeAssistantError

from .const import DOMAIN, VERSION

_LOGGER = logging.getLogger(__name__)
DATA_FRONTEND = f'{DOMAIN}_frontend'
URL_BASE = '/essensplan_static'
CARD_URL = f'{URL_BASE}/essensplan-card.js?v={VERSION}'
PANEL_URL = f'{URL_BASE}/essensplan-panel.js?v={VERSION}'


@dataclass
class FrontendState:
    panel_path: str | None = None


async def async_register_frontend(hass):
    """Static routes live for the HA process, including entry reloads."""
    if DATA_FRONTEND in hass.data:
        return
    await hass.http.async_register_static_paths([
        StaticPathConfig(URL_BASE, str(Path(__file__).parent / 'frontend'), True),
    ])
    frontend.add_extra_js_url(hass, CARD_URL)
    hass.data[DATA_FRONTEND] = FrontendState()


def _owns_resource(url):
    if not isinstance(url, str):
        return False
    parsed = urlsplit(url)
    return not parsed.scheme and not parsed.netloc and parsed.path in {
        '/local/essensplan-card.js', f'{URL_BASE}/essensplan-card.js',
    }


def _has_card(value):
    if isinstance(value, dict):
        return value.get('type') == 'custom:essensplan-card' or any(
            _has_card(item) for item in value.values()
        )
    return isinstance(value, list) and any(_has_card(item) for item in value)


async def _async_migrate_resources(resources):
    # Storage resources can be lazy-loaded. Loading before inspecting/updating is
    # essential: otherwise unrelated resources may be overwritten at HA startup.
    await resources.async_get_info()
    owned = [item for item in resources.async_items() if _owns_resource(item.get('url'))]
    if not owned or not hasattr(resources, 'async_update_item'):
        return  # New installs and YAML resources use the automatic module loader.
    keep = owned[0]
    if keep['url'] != CARD_URL or keep.get('type') != 'module':
        await resources.async_update_item(keep['id'], {
            'url': CARD_URL, CONF_RESOURCE_TYPE_WS: 'module',
        })
    for duplicate in owned[1:]:
        await resources.async_delete_item(duplicate['id'])


async def async_setup_frontend_entry(hass):
    """Reuse an existing meal-planner dashboard; otherwise add a ready-made panel."""
    await async_register_frontend(hass)
    data = hass.data[LOVELACE_DATA]
    await _async_migrate_resources(data.resources)
    state = hass.data[DATA_FRONTEND]
    if state.panel_path is not None:
        return
    for dashboard in data.dashboards.values():
        try:
            config = await dashboard.async_load(False)
        except HomeAssistantError:
            continue  # A new default dashboard may not have saved configuration.
        if _has_card(config):
            return

    panels = hass.data.get(frontend.DATA_PANELS, {})
    path = DOMAIN
    suffix = 1
    while path in panels:
        suffix += 1
        path = f'{DOMAIN}-{suffix}'
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=path,
        webcomponent_name='essensplan-panel',
        sidebar_title='Essensplan',
        sidebar_icon='mdi:silverware-fork-knife',
        module_url=PANEL_URL,
        embed_iframe=False,
        require_admin=False,
    )
    state.panel_path = path
    _LOGGER.debug('Essensplan sidebar panel registered at /%s', path)


def async_unload_frontend_entry(hass):
    """Remove only the panel created by this integration, preserving dashboards."""
    state = hass.data.get(DATA_FRONTEND)
    if state is not None and state.panel_path is not None:
        frontend.async_remove_panel(hass, state.panel_path)
        state.panel_path = None
