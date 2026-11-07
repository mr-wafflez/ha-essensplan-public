"""Current meal, refreshed at local midnight and after every transaction."""
from homeassistant.components.sensor import SensorEntity
from homeassistant.helpers.entity import EntityCategory
from .const import DOMAIN
from .model import meals_for


async def async_setup_entry(hass, entry, async_add_entities):
    planner = hass.data[DOMAIN]
    async_add_entities([MealSensor(planner), SyncSensor(planner.sync)])


class MealSensor(SensorEntity):
    _attr_should_poll = False
    _attr_name = 'Essensplan Heute'
    _attr_unique_id = 'essensplan_today'
    _attr_icon = 'mdi:food-fork-drink'

    def __init__(self, planner):
        self.planner = planner

    async def async_added_to_hass(self):
        self.async_on_remove(self.planner.subscribe(self.async_write_ha_state))

    @property
    def native_value(self):
        data = self.planner.snapshot()
        names = [data['recipes'][m['recipe_id']]['name'] for m in meals_for(data, data['today'])
                 if m and m['recipe_id'] in data['recipes']]
        return (' · '.join(names) or 'Noch nichts geplant')[:255]

    @property
    def extra_state_attributes(self):
        data = self.planner.snapshot()
        meals = [{'slot': slot, **meal, 'name': data['recipes'].get(meal['recipe_id'], {}).get('name')}
                 for slot, meal in enumerate(meals_for(data, data['today'])) if meal]
        meal = meals[0] if meals else {}
        return {'essensplan': True, 'revision': data['revision'], 'date': data['today'],
                'recipe_id': meal.get('recipe_id'), 'servings': meal.get('servings'),
                'meals_per_day': data['meals_per_day'], 'meals': meals}


class SyncSensor(SensorEntity):
    _attr_should_poll = False
    _attr_name = 'Essensplan Synchronisation'
    _attr_unique_id = 'essensplan_sync_status'
    _attr_icon = 'mdi:sync'
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, sync):
        self.sync = sync

    async def async_added_to_hass(self):
        self.async_on_remove(self.sync.subscribe(self.async_write_ha_state))

    @property
    def native_value(self):
        return self.sync.state

    @property
    def extra_state_attributes(self):
        return {'enabled': self.sync.enabled, 'target': self.sync.target, 'last_success': self.sync.last_success,
                'error': self.sync.error}
