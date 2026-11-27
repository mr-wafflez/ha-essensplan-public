"""Configure one shared household planner from the UI."""
from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.helpers import selector
from .compat import vol
from .const import (CONF_MEALS_PER_DAY, CONF_NUTRITION_ENABLED, CONF_OFF_PASSWORD, CONF_OFF_STAGING, CONF_OFF_USER,
                    CONF_SYNC_ENABLED, CONF_SYNC_TARGET, DEFAULT_MEALS_PER_DAY, DOMAIN, MAX_MEALS_PER_DAY)
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
                data = {
                    **options,
                    CONF_SYNC_ENABLED: enabled,
                    CONF_MEALS_PER_DAY: int(count),
                    CONF_NUTRITION_ENABLED: user_input.get(
                        CONF_NUTRITION_ENABLED, options.get(CONF_NUTRITION_ENABLED, False)
                    ),
                }
                if target:
                    data[CONF_SYNC_TARGET] = target
                else:
                    data.pop(CONF_SYNC_TARGET, None)
                # Open Food Facts account for contributing products. An empty password
                # keeps the stored one; an empty user name removes the account.
                user = (user_input.get(CONF_OFF_USER) or '').strip() if CONF_OFF_USER in user_input \
                    else options.get(CONF_OFF_USER, '')
                password = user_input.get(CONF_OFF_PASSWORD) or options.get(CONF_OFF_PASSWORD, '')
                if user and '@' in user:
                    errors[CONF_OFF_USER] = 'off_user_not_email'
                elif user and not password:
                    errors[CONF_OFF_PASSWORD] = 'off_password_missing'
                if errors:
                    return self._form(errors, {**options, **user_input})
                for key in (CONF_OFF_USER, CONF_OFF_PASSWORD, CONF_OFF_STAGING):
                    data.pop(key, None)
                if user:
                    data[CONF_OFF_USER] = user
                    data[CONF_OFF_PASSWORD] = password
                    if user_input.get(CONF_OFF_STAGING, options.get(CONF_OFF_STAGING, False)):
                        data[CONF_OFF_STAGING] = True
                return self.async_create_entry(title='', data=data)
        return self._form(errors, {**options, **(user_input or {})})

    def _form(self, errors, values):
        return self.async_show_form(step_id='init', errors=errors, data_schema=vol.Schema({
            vol.Required(CONF_MEALS_PER_DAY, default=values.get(CONF_MEALS_PER_DAY, DEFAULT_MEALS_PER_DAY)):
                selector.NumberSelector(selector.NumberSelectorConfig(min=1, max=MAX_MEALS_PER_DAY, step=1, mode='box')),
            vol.Required(CONF_SYNC_ENABLED, default=values.get(CONF_SYNC_ENABLED, bool(values.get(CONF_SYNC_TARGET)))):
                selector.BooleanSelector(),
            vol.Required(CONF_NUTRITION_ENABLED, default=values.get(CONF_NUTRITION_ENABLED, False)):
                selector.BooleanSelector(),
            vol.Optional(CONF_SYNC_TARGET, description={'suggested_value': values.get(CONF_SYNC_TARGET)}):
                selector.EntitySelector(selector.EntitySelectorConfig(domain='todo')),
            vol.Optional(CONF_OFF_USER, description={'suggested_value': values.get(CONF_OFF_USER, '')}):
                selector.TextSelector(),
            # The stored password is never sent back to the browser.
            vol.Optional(CONF_OFF_PASSWORD): selector.TextSelector(
                selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)),
            vol.Optional(CONF_OFF_STAGING, default=values.get(CONF_OFF_STAGING, False)): selector.BooleanSelector(),
        }))
