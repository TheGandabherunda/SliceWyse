import { describe, expect, it } from 'vitest';
import { EventDagService, type DagNode } from '../../src/domain/services/EventDagService';

describe('Milestone 11: Single Source of Truth Recovery UI & Event DAG Ordering', () => {
  const dagService = new EventDagService();

  it('orders events exclusively by DAG depth and SortKey formula, independent of wall-clock timestamps or arrival order', () => {
    // Child event has earlier timestamp (1000) but depends on parent event (created_at = 2000)
    const parentEvent: DagNode = {
      eventId: 'evt_parent_root',
      kind: 1500,
      pubkey: 'pub_alice',
      createdAt: 2000,
      groupId: 'grp_dag_order',
      parentEventIds: [],
      payload: { type: 'GROUP_CREATED', groupId: 'grp_dag_order', name: 'DAG Group' },
    };

    const childEvent: DagNode = {
      eventId: 'evt_child_dep',
      kind: 1501,
      pubkey: 'pub_bob',
      createdAt: 1000, // Earlier timestamp than parent!
      groupId: 'grp_dag_order',
      parentEventIds: ['evt_parent_root'],
      payload: { type: 'EXPENSE_CREATED', id: 'exp_1' },
    };

    // Case 1: Ingested in reversed arrival order [childEvent, parentEvent]
    const reversedArrival = [childEvent, parentEvent];
    const sorted1 = dagService.sortNodesTopologically(reversedArrival);

    expect(sorted1[0].eventId).toBe('evt_parent_root'); // Parent (Depth 0) MUST come first despite 2000 > 1000 timestamp
    expect(sorted1[1].eventId).toBe('evt_child_dep');

    // Case 2: Ingested in natural arrival order [parentEvent, childEvent]
    const naturalArrival = [parentEvent, childEvent];
    const sorted2 = dagService.sortNodesTopologically(naturalArrival);

    expect(sorted2[0].eventId).toBe('evt_parent_root');
    expect(sorted2[1].eventId).toBe('evt_child_dep');

    // Both ordering results are identical
    expect(sorted1.map((n) => n.eventId)).toEqual(sorted2.map((n) => n.eventId));
  });
});
