import { describe, expect, it } from 'vitest';
import { OrphanBuffer } from '../../src/domain/services/OrphanBuffer';
import type { ValidatedEvent } from '../../src/domain/services/EventValidationPipeline';

describe('Milestone 3: Orphan Buffer & Dependency Management', () => {
  it('buffers events with missing parents and drains them when parents are resolved', async () => {
    const buffer = new OrphanBuffer();

    const parentEvent: ValidatedEvent = {
      isValid: true,
      event: {
        id: 'evt_parent_100',
        kind: 1500,
        pubkey: 'pubkey_alice',
        created_at: 1000,
        tags: [['d', 'grp_123']],
        content: '{}',
        sig: 'sig',
      },
      groupId: 'grp_123',
      parentEventIds: [],
    };

    const childEvent: ValidatedEvent = {
      isValid: true,
      event: {
        id: 'evt_child_200',
        kind: 1501,
        pubkey: 'pubkey_bob',
        created_at: 1005,
        tags: [['d', 'grp_123']],
        content: '{}',
        sig: 'sig',
      },
      groupId: 'grp_123',
      parentEventIds: ['evt_parent_100'],
    };

    // Buffer child event (since parent is not yet persisted)
    buffer.addOrphan(childEvent);
    expect(buffer.hasOrphan('evt_child_200')).toBe(true);
    expect(buffer.size).toBe(1);

    const persistedDb = new Set<string>();

    // Try draining before parent is persisted -> returns empty
    let drained = await buffer.drainReadyOrphans(async (pId) => persistedDb.has(pId));
    expect(drained).toHaveLength(0);
    expect(buffer.size).toBe(1);

    // Persist parent
    persistedDb.add('evt_parent_100');

    // Drain again -> child event released!
    drained = await buffer.drainReadyOrphans(async (pId) => persistedDb.has(pId));
    expect(drained).toHaveLength(1);
    expect(drained[0].event.id).toBe('evt_child_200');
    expect(buffer.size).toBe(0);
  });
});
