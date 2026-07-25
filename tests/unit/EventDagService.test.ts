import { describe, it, expect } from 'vitest';
import { eventDagService, type DagNode } from '../../src/domain/services/EventDagService';

describe('EventDagService DAG Ancestry & Merge Resolution', () => {
  it('detects concurrent edit forks when two events reference the same parentEventId', () => {
    const e4: DagNode = {
      eventId: 'evt_e4',
      kind: 1501,
      pubkey: 'pubkey_alice',
      createdAt: 1000,
      groupId: 'grp_1',
      parentEventIds: [],
      payload: { title: 'Dinner v4' },
    };

    const e5a: DagNode = {
      eventId: 'evt_e5a',
      kind: 1501,
      pubkey: 'pubkey_alice',
      createdAt: 1010,
      groupId: 'grp_1',
      parentEventIds: ['evt_e4'],
      payload: { title: 'Dinner v5 by Alice' },
    };

    const e5b: DagNode = {
      eventId: 'evt_e5b',
      kind: 1501,
      pubkey: 'pubkey_bob',
      createdAt: 1012,
      groupId: 'grp_1',
      parentEventIds: ['evt_e4'],
      payload: { title: 'Dinner v5 by Bob' },
    };

    const res = eventDagService.processDagNodes([e4, e5a, e5b]);
    expect(res.hasConflict).toBe(true);
    expect(res.activeBranchIds).toEqual(expect.arrayContaining(['evt_e5a', 'evt_e5b']));
  });

  it('resolves concurrent forks when a merge event references all conflicting branch heads in parentEventIds', () => {
    const e4: DagNode = {
      eventId: 'evt_e4',
      kind: 1501,
      pubkey: 'pubkey_alice',
      createdAt: 1000,
      groupId: 'grp_1',
      parentEventIds: [],
      payload: { title: 'Dinner v4' },
    };

    const e5a: DagNode = {
      eventId: 'evt_e5a',
      kind: 1501,
      pubkey: 'pubkey_alice',
      createdAt: 1010,
      groupId: 'grp_1',
      parentEventIds: ['evt_e4'],
      payload: { title: 'Dinner v5 by Alice' },
    };

    const e5b: DagNode = {
      eventId: 'evt_e5b',
      kind: 1501,
      pubkey: 'pubkey_bob',
      createdAt: 1012,
      groupId: 'grp_1',
      parentEventIds: ['evt_e4'],
      payload: { title: 'Dinner v5 by Bob' },
    };

    // Merge resolution event E6 referencing BOTH E5A and E5B
    const e6: DagNode = {
      eventId: 'evt_e6_merge',
      kind: 1501,
      pubkey: 'pubkey_alice',
      createdAt: 1020,
      groupId: 'grp_1',
      parentEventIds: ['evt_e5a', 'evt_e5b'],
      payload: { title: 'Dinner v6 Merged' },
    };

    const res = eventDagService.processDagNodes([e4, e5a, e5b, e6]);
    expect(res.hasConflict).toBe(false);
    expect(res.activeBranchIds).toEqual(['evt_e6_merge']);
    expect(res.latestEventId).toBe('evt_e6_merge');
  });
});
