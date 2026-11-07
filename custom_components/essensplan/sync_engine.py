"""Persistent reconciliation of generated ingredients with an external list.

Only explicitly linked IDs are updated or removed. Unrelated/manual entries are
never adopted by title. A write-ahead journal makes an unconfirmed addition stop
further additions instead of producing duplicates after a timeout or restart.
"""
from copy import deepcopy
import unicodedata


class SyncError(Exception):
    """A reconciliation cannot safely continue."""


def normalized(value):
    return unicodedata.normalize('NFKC', value).casefold().strip()


class SyncEngine:
    def __init__(self, source, complete, client, save, state=None):
        self.source = source
        self.complete = complete
        self.client = client
        self.save = save
        self.state = deepcopy(state) if state is not None else {'links': {}, 'pending': None}
        if not isinstance(self.state, dict) or not isinstance(self.state.get('links'), dict) or 'pending' not in self.state:
            raise SyncError('invalid_journal')
        remote_ids = set()
        for uid, link in self.state['links'].items():
            if (not isinstance(uid, str) or not isinstance(link, dict)
                    or not isinstance(link.get('remote_uid'), str) or not link['remote_uid']
                    or not isinstance(link.get('completed'), bool) or link['remote_uid'] in remote_ids):
                raise SyncError('invalid_journal')
            remote_ids.add(link['remote_uid'])
        pending = self.state['pending']
        if pending is not None and (not isinstance(pending, dict)
                or not isinstance(pending.get('uid'), str) or not isinstance(pending.get('summary'), str)
                or not isinstance(pending.get('before'), list)
                or not all(isinstance(uid, str) for uid in pending['before'])
                or pending.get('marker') is not None and not isinstance(pending['marker'], str)):
            raise SyncError('invalid_journal')

    async def _save(self, state):
        await self.save(deepcopy(state))
        self.state = state

    async def _link(self, uid, value):
        state = deepcopy(self.state)
        if value is None:
            state['links'].pop(uid, None)
        else:
            state['links'][uid] = value
        await self._save(state)

    async def _read(self):
        values = await self.client.read()
        if not isinstance(values, list):
            raise SyncError('invalid_target_response')
        result = {}
        for item in values:
            if (not isinstance(item, dict) or not isinstance(item.get('uid'), str)
                    or not item['uid'] or not isinstance(item.get('summary'), str)
                    or item.get('status') not in ('completed', 'needs_action')
                    or item['uid'] in result):
                raise SyncError('invalid_target_response')
            result[item['uid']] = item
        return result

    async def _resolve_pending(self, remote):
        pending = self.state['pending']
        if pending is None:
            return
        before = set(pending['before'])
        candidates = [item for uid, item in remote.items()
                      if uid not in before and normalized(item['summary']) == normalized(pending['summary'])]
        # If supported, the backend carries a unique marker for crash recovery.
        if pending.get('marker'):
            candidates = [item for item in remote.values() if item.get('description') == pending['marker']]
        if len(candidates) != 1:
            raise SyncError('unconfirmed_addition' if not candidates else 'ambiguous_addition')
        state = deepcopy(self.state)
        state['links'][pending['uid']] = {'remote_uid': candidates[0]['uid'], 'completed': False}
        state['pending'] = None
        await self._save(state)

    async def run(self):
        remote = await self._read()
        await self._resolve_pending(remote)
        desired = {item['uid']: item for item in self.source()['shopping']}

        for uid, link in list(self.state['links'].items()):
            rid = link['remote_uid']
            if uid not in desired:
                if rid in remote:
                    await self.client.remove(rid)
                    remote = await self._read()
                    if rid in remote:
                        raise SyncError('target_delete_unconfirmed')
                await self._link(uid, None)
            elif rid not in remote:
                # Clearing completed history must not resurrect it. An active
                # ingredient removed externally is recreated from its recipe.
                await self._link(uid, None)

        for uid in list(desired):
            snapshot = self.source()
            item = next((item for item in snapshot['shopping'] if item['uid'] == uid), None)
            if item is None:
                continue  # A simultaneous plan edit will be reconciled next time.
            link = self.state['links'].get(uid)
            if link is None:
                if item['completed']:
                    continue
                marker = self.client.marker(uid)
                state = deepcopy(self.state)
                state['pending'] = {'uid': uid, 'summary': item['summary'],
                                    'before': list(remote), 'marker': marker}
                await self._save(state)  # Must succeed before the remote write.
                await self.client.add(item['summary'], marker)
                remote = await self._read()
                await self._resolve_pending(remote)
                link = self.state['links'][uid]

            target = remote[link['remote_uid']]
            local_done = item['completed']
            target_done = target['status'] == 'completed'
            changes = {}
            if normalized(target['summary']) != normalized(item['summary']):
                changes['rename'] = item['summary']
            if local_done != link['completed']:
                if target_done != local_done:
                    changes['status'] = 'completed' if local_done else 'needs_action'
            elif target_done != link['completed']:
                # Revision guards prevent an external check mark overwriting a
                # simultaneous edit in the recipe planner.
                await self.complete(uid, target_done, snapshot['revision'])
                local_done = target_done
            if changes:
                await self.client.update(link['remote_uid'], changes)
                remote = await self._read()
                confirmed = remote.get(link['remote_uid'])
                if confirmed is None or (changes.get('status') and confirmed['status'] != changes['status']):
                    raise SyncError('target_update_unconfirmed')
            if link['completed'] != local_done:
                await self._link(uid, {'remote_uid': link['remote_uid'], 'completed': local_done})

    async def retry_unconfirmed(self):
        """Explicit operator recovery after checking the target for a missing add."""
        if self.state['pending'] is None:
            return
        remote = await self._read()
        try:
            await self._resolve_pending(remote)
        except SyncError as err:
            if str(err) != 'unconfirmed_addition':
                raise
            state = deepcopy(self.state)
            state['pending'] = None
            await self._save(state)
