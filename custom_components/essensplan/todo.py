"""Generated shopping list, with persistent check marks."""
from homeassistant.components.todo import TodoItem, TodoItemStatus, TodoListEntity, TodoListEntityFeature
from homeassistant.exceptions import HomeAssistantError
from .const import DOMAIN


async def async_setup_entry(hass, entry, async_add_entities):
    async_add_entities([ShoppingList(hass.data[DOMAIN])])


class ShoppingList(TodoListEntity):
    _attr_should_poll = False
    _attr_name = 'Essensplan Einkaufsliste'
    _attr_unique_id = 'essensplan_shopping'
    _attr_supported_features = TodoListEntityFeature.UPDATE_TODO_ITEM

    def __init__(self, planner):
        self.planner = planner

    async def async_added_to_hass(self):
        self.async_on_remove(self.planner.subscribe(self.async_write_ha_state))

    @property
    def todo_items(self):
        return [TodoItem(uid=i['uid'], summary=i['summary'],
                         status=TodoItemStatus.COMPLETED if i['completed'] else TodoItemStatus.NEEDS_ACTION)
                for i in self.planner.snapshot()['shopping']]

    async def async_update_todo_item(self, item):
        original = next((i for i in self.todo_items if i.uid == item.uid), None)
        if original is None or item.summary != original.summary or item.due is not None or item.description is not None:
            raise HomeAssistantError('Generierte Zutaten können nur abgehakt werden. Mengen im Rezept/Plan ändern.')
        if item.status not in (TodoItemStatus.COMPLETED, TodoItemStatus.NEEDS_ACTION):
            raise HomeAssistantError('Ungültiger Status')
        try:
            await self.planner.change('complete', {'uid': item.uid, 'completed': item.status == TodoItemStatus.COMPLETED})
        except ValueError as err:
            raise HomeAssistantError(str(err)) from err
