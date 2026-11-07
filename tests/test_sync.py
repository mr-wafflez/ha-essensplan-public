"""Failure/restart and ownership tests for bidirectional shopping-list sync."""
from copy import deepcopy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('sync_engine', Path(__file__).parents[1] / 'custom_components/essensplan/sync_engine.py')
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


class Source:
    def __init__(self):
        self.items = [{'uid': 'week-a-500g', 'summary': '500 g Kartoffeln', 'completed': False}]
        self.revision = 1
        self.fail_complete = False

    def snapshot(self):
        return {'shopping': deepcopy(self.items), 'revision': self.revision}

    async def complete(self, uid, completed, revision):
        if self.fail_complete or self.revision != revision:
            raise ValueError('Conflicting edit')
        next(item for item in self.items if item['uid'] == uid)['completed'] = completed
        self.revision += 1


class Client:
    def __init__(self):
        self.items = {'manual': {'uid': 'manual', 'summary': 'Spülmittel', 'status': 'needs_action', 'description': 'Behalten'}}
        self.next_id = 1
        self.adds = 0
        self.removes = []
        self.updates = []
        self.fail_before_add = False
        self.fail_after_add = False
        self.ignore_updates = False
        self.ignore_removes = False
        self.marker_supported = True
        self.response_override = False

    def marker(self, uid):
        return 'Essensplan [test:' + uid + ']' if self.marker_supported else None

    async def read(self):
        if self.response_override is not False:
            return deepcopy(self.response_override)
        return deepcopy(list(self.items.values()))

    async def add(self, summary, marker):
        self.adds += 1
        if self.fail_before_add:
            raise OSError('Offline')
        uid = 'remote-' + str(self.next_id)
        self.next_id += 1
        self.items[uid] = {'uid': uid, 'summary': summary, 'status': 'needs_action'}
        if marker:
            self.items[uid]['description'] = marker
        if self.fail_after_add:
            raise OSError('Response lost')

    async def update(self, uid, changes):
        self.updates.append((uid, changes))
        if not self.ignore_updates:
            if 'rename' in changes:
                self.items[uid]['summary'] = changes['rename']
            if 'status' in changes:
                self.items[uid]['status'] = changes['status']

    async def remove(self, uid):
        self.removes.append(uid)
        if not self.ignore_removes:
            del self.items[uid]


class SyncTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.source, self.client = Source(), Client()
        self.saved = None
        self.saves = 0
        self.fail_save_at = None
        self.engine = self.make_engine()

    def make_engine(self):
        return sync.SyncEngine(self.source.snapshot, self.source.complete, self.client, self.save, self.saved)

    async def save(self, state):
        self.saves += 1
        if self.saves == self.fail_save_at:
            raise OSError('Disk full')
        self.saved = deepcopy(state)

    async def initial(self):
        await self.engine.run()
        self.rid = self.saved['links']['week-a-500g']['remote_uid']

    async def test_repeated_sync_and_restart_do_not_duplicate_items(self):
        await self.initial()
        await self.engine.run()
        self.engine = self.make_engine()
        await self.engine.run()
        self.assertEqual(self.client.adds, 1)
        self.assertEqual(len(self.client.items), 2)

    async def test_manual_same_title_is_never_adopted_or_modified(self):
        self.client.items['manual']['summary'] = self.source.items[0]['summary']
        original = deepcopy(self.client.items['manual'])
        await self.initial()
        self.source.items = []
        await self.engine.run()
        self.assertEqual(self.client.items, {'manual': original})
        self.assertEqual(self.client.removes, [self.rid])

    async def test_external_check_and_uncheck_reach_planner(self):
        await self.initial()
        for status, done in [('completed', True), ('needs_action', False)]:
            self.client.items[self.rid]['status'] = status
            await self.engine.run()
            self.assertIs(self.source.items[0]['completed'], done)
            self.assertIs(self.saved['links']['week-a-500g']['completed'], done)

    async def test_local_check_and_uncheck_reach_target(self):
        await self.initial()
        for done, status in [(True, 'completed'), (False, 'needs_action')]:
            self.source.items[0]['completed'] = done
            self.source.revision += 1
            await self.engine.run()
            self.assertEqual(self.client.items[self.rid]['status'], status)

    async def test_quantity_or_week_change_removes_only_owned_previous_item(self):
        await self.initial()
        self.source.items = [{'uid': 'week-b-1000g', 'summary': '1000 g Kartoffeln', 'completed': False}]
        await self.engine.run()
        self.assertNotIn(self.rid, self.client.items)
        self.assertIn('manual', self.client.items)
        self.assertEqual(set(self.saved['links']), {'week-b-1000g'})
        self.assertEqual(self.client.adds, 2)

    async def test_external_extra_notes_and_due_date_are_preserved(self):
        await self.initial()
        self.client.items[self.rid].update(description='Eigene Notiz', due='2026-10-19')
        self.source.items[0]['completed'] = True
        await self.engine.run()
        self.assertEqual(self.client.items[self.rid]['description'], 'Eigene Notiz')
        self.assertEqual(self.client.items[self.rid]['due'], '2026-10-19')

    async def test_removed_active_ingredient_is_recreated_once(self):
        await self.initial()
        del self.client.items[self.rid]
        await self.engine.run()
        await self.engine.run()
        self.assertEqual(self.client.adds, 2)

    async def test_cleared_completed_history_is_not_recreated(self):
        await self.initial()
        self.source.items[0]['completed'] = True
        await self.engine.run()
        del self.client.items[self.rid]
        await self.engine.run()
        self.assertEqual(self.client.adds, 1)
        self.source.items[0]['completed'] = False
        await self.engine.run()
        self.assertEqual(self.client.adds, 2)

    async def test_initially_completed_ingredients_are_not_exported_as_new_work(self):
        self.source.items[0]['completed'] = True
        await self.engine.run()
        self.assertEqual(self.client.adds, 0)

    async def test_failed_journal_write_prevents_remote_add(self):
        self.fail_save_at = 1
        with self.assertRaises(OSError):
            await self.engine.run()
        self.assertEqual(self.client.adds, 0)
        self.assertIsNone(self.saved)

    async def test_lost_add_response_is_recovered_after_restart_without_duplicate(self):
        self.client.fail_after_add = True
        with self.assertRaises(OSError):
            await self.engine.run()
        self.client.fail_after_add = False
        self.engine = self.make_engine()
        await self.engine.run()
        self.assertEqual(self.client.adds, 1)
        self.assertIsNone(self.saved['pending'])

    async def test_failed_link_save_is_recovered_from_persisted_intent(self):
        self.fail_save_at = 2
        with self.assertRaises(OSError):
            await self.engine.run()
        self.fail_save_at = None
        self.engine = self.make_engine()
        await self.engine.run()
        self.assertEqual(self.client.adds, 1)

    async def test_uncertain_add_is_not_blindly_retried(self):
        self.client.fail_before_add = True
        with self.assertRaises(OSError):
            await self.engine.run()
        self.client.fail_before_add = False
        self.engine = self.make_engine()
        for _ in range(2):
            with self.assertRaisesRegex(sync.SyncError, 'unconfirmed_addition'):
                await self.engine.run()
        self.assertEqual(self.client.adds, 1)

    async def test_operator_can_retry_after_confirming_failed_add_is_absent(self):
        self.client.fail_before_add = True
        with self.assertRaises(OSError):
            await self.engine.run()
        self.client.fail_before_add = False
        await self.engine.retry_unconfirmed()
        await self.engine.run()
        self.assertEqual(self.client.adds, 2)
        self.assertEqual(len(self.client.items), 2)

    async def test_operator_retry_first_recovers_an_existing_remote_item(self):
        self.client.fail_after_add = True
        with self.assertRaises(OSError):
            await self.engine.run()
        self.client.fail_after_add = False
        await self.engine.retry_unconfirmed()
        await self.engine.run()
        self.assertEqual(self.client.adds, 1)

    async def test_ambiguous_recovery_does_not_claim_or_delete_either_item(self):
        self.client.fail_after_add = True
        with self.assertRaises(OSError):
            await self.engine.run()
        other = deepcopy(self.client.items['remote-1'])
        other['uid'] = 'remote-2'
        self.client.items['remote-2'] = other
        with self.assertRaisesRegex(sync.SyncError, 'ambiguous_addition'):
            await self.engine.run()
        self.assertFalse(self.client.removes)
        self.assertFalse(self.saved['links'])

    async def test_lists_without_descriptions_use_returned_uid_difference(self):
        self.client.marker_supported = False
        await self.initial()
        self.engine = self.make_engine()
        await self.engine.run()
        self.assertEqual(self.client.adds, 1)

    async def test_simultaneous_planner_edit_is_not_overwritten(self):
        await self.initial()
        self.client.items[self.rid]['status'] = 'completed'
        self.source.fail_complete = True
        with self.assertRaises(ValueError):
            await self.engine.run()
        self.assertFalse(self.source.items[0]['completed'])
        self.assertFalse(self.saved['links']['week-a-500g']['completed'])

    async def test_backend_that_does_not_confirm_update_cannot_reverse_local_check(self):
        await self.initial()
        self.client.ignore_updates = True
        self.source.items[0]['completed'] = True
        for _ in range(2):
            with self.assertRaisesRegex(sync.SyncError, 'target_update_unconfirmed'):
                await self.engine.run()
        self.assertTrue(self.source.items[0]['completed'])
        self.assertFalse(self.saved['links']['week-a-500g']['completed'])

    async def test_backend_that_does_not_confirm_delete_keeps_ownership(self):
        await self.initial()
        self.client.ignore_removes = True
        self.source.items = []
        with self.assertRaisesRegex(sync.SyncError, 'target_delete_unconfirmed'):
            await self.engine.run()
        self.assertIn('week-a-500g', self.saved['links'])

    async def test_malformed_target_response_never_causes_writes(self):
        await self.initial()
        for invalid in [None, {}, [{'uid': 'x', 'summary': 'a'}],
                        [{'uid': 'x', 'summary': 'a', 'status': 'unknown'}]]:
            self.client.response_override = invalid
            with self.assertRaisesRegex(sync.SyncError, 'invalid_target_response'):
                await self.engine.run()
        self.assertEqual(self.client.adds, 1)
        self.assertFalse(self.client.removes)

    def test_corrupt_journal_is_rejected(self):
        for state in [[], {}, {'links': [], 'pending': None},
                      {'links': {'x': {}}, 'pending': None}, {'links': {}, 'pending': {'uid': 'x'}}]:
            with self.assertRaises(sync.SyncError):
                sync.SyncEngine(self.source.snapshot, self.source.complete, self.client, self.save, state)

    async def test_concurrent_same_title_manual_addition_does_not_override_marker(self):
        self.client.fail_after_add = True
        with self.assertRaises(OSError):
            await self.engine.run()
        self.client.items['manual-new'] = {'uid': 'manual-new', 'summary': '500 g Kartoffeln', 'status': 'needs_action'}
        self.client.fail_after_add = False
        await self.engine.run()
        self.assertEqual(self.saved['links']['week-a-500g']['remote_uid'], 'remote-1')
        self.assertIn('manual-new', self.client.items)


if __name__ == '__main__':
    unittest.main()
