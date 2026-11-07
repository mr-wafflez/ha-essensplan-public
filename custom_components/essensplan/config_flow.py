"""Configure one shared household planner from the UI."""
from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.helpers import selector
from .compat import vol
from .const import (CONF_MEALS_PER_DAY, CONF_SYNC_ENABLED, CONF_SYNC_TARGET,
                    DEFAULT_MEALS_PER_DAY, DOMAIN, MAX_MEALS_PER_DAY)
from .sync import valid_target


class EssensplanConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return EssensplanOptionsFlow()

    async def async_step_user(self, user_input=None):
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        if user_input is not None:
            return self.async_create_entry(title='Essensplan', data={})
        return self.async_show_form(step_id='user', data_schema=vol.Schema({}))


class EssensplanOptionsFlow(config_entries.OptionsFlow):
    async def async_step_init(self, user_input=None):
        errors = {}
        options = self.config_entry.options
        if user_input is not None:
            count = user_input.get(CONF_MEALS_PER_DAY, options.get(CONF_MEALS_PER_DAY, DEFAULT_MEALS_PER_DAY))
            target = user_input.get(CONF_SYNC_TARGET, options.get(CONF_SYNC_TARGET))
            enabled = user_input.get(CONF_SYNC_ENABLED, options.get(CONF_SYNC_ENABLED, bool(target)))
            if isinstance(count, bool) or not isinstance(count, (int, float)) or not 1 <= count <= MAX_MEALS_PER_DAY or int(count) != count:
                errors[CONF_MEALS_PER_DAY] = 'invalid_meals_per_day'
            elif enabled and not target:
                errors[CONF_SYNC_TARGET] = 'missing_target'
            elif enabled and not valid_target(self.hass, target, self.config_entry.entry_id):
                errors[CONF_SYNC_TARGET] = 'unsupported_target'
            else:
                data = {**options, CONF_SYNC_ENABLED: enabled, CONF_MEALS_PER_DAY: int(count)}
                if target:
                    data[CONF_SYNC_TARGET] = target
                else:
                    data.pop(CONF_SYNC_TARGET, None)
                return self.async_create_entry(title='', data=data)
        values = {**options, **(user_input or {})}
        return self.async_show_form(step_id='init', errors=errors, data_schema=vol.Schema({
            vol.Required(CONF_MEALS_PER_DAY, default=values.get(CONF_MEALS_PER_DAY, DEFAULT_MEALS_PER_DAY)):
                selector.NumberSelector(selector.NumberSelectorConfig(min=1, max=MAX_MEALS_PER_DAY, step=1, mode='box')),
            vol.Required(CONF_SYNC_ENABLED, default=values.get(CONF_SYNC_ENABLED, bool(values.get(CONF_SYNC_TARGET)))):
                selector.BooleanSelector(),
            vol.Optional(CONF_SYNC_TARGET, description={'suggested_value': values.get(CONF_SYNC_TARGET)}):
                selector.EntitySelector(selector.EntitySelectorConfig(domain='todo')),
        }))
