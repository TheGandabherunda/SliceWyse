import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '../../src/infrastructure/db/SliceWyseDatabase';
import { relayManager } from '../../src/infrastructure/nostr/RelayManager';
import { syncCoordinator } from '../../src/application/services/SyncCoordinator';
import { identityService } from '../../src/infrastructure/identity/IdentityService';
import { generateSecretKey } from 'nostr-tools/pure';
import { bytesToHex } from 'nostr-tools/utils';

describe('Relay Failure & Replication State Machine Tests', () => {
  beforeEach(async () => {
    await db.identities.clear();
    await db.sync_queue.clear();
    await identityService.importSecretKey(bytesToHex(generateSecretKey()), 'Alice');
  });

  it('keeps event in sync queue when 1 relay accepts and transitions status to ACCEPTED_BY_ONE_RELAY', async () => {
    vi.spyOn(relayManager, 'publishEvent').mockResolvedValue(['wss://relay1.com']);

    await syncCoordinator.enqueueEvent('grp_rel_test', 1501, {
      type: 'EXPENSE_CREATED',
      groupId: 'grp_rel_test',
      expenseId: 'exp_rel_1',
      title: 'Lunch',
      amountCents: 1000,
    });
    await syncCoordinator.processSyncQueue();

    const item = await db.sync_queue.where({ groupId: 'grp_rel_test' }).first();
    expect(item).toBeDefined();
    expect(item?.status).toBe('ACCEPTED_BY_ONE_RELAY');
    expect(item?.acceptedRelaysJson).toContain('wss://relay1.com');
  });

  it('purges queue item when replicated across multiple relays (ACCEPTED >= 2)', async () => {
    vi.spyOn(relayManager, 'publishEvent').mockResolvedValue([
      'wss://relay1.com',
      'wss://relay2.com',
    ]);

    await syncCoordinator.enqueueEvent('grp_rel_test2', 1501, {
      type: 'EXPENSE_CREATED',
      groupId: 'grp_rel_test2',
      expenseId: 'exp_rel_2',
      title: 'Dinner',
      amountCents: 2000,
    });
    await syncCoordinator.processSyncQueue();

    const item = await db.sync_queue.where({ groupId: 'grp_rel_test2' }).first();
    // Replicated item is purged from queue
    expect(item).toBeUndefined();
  });

  it('marks RETRY_REQUIRED when all relays reject event', async () => {
    vi.spyOn(relayManager, 'publishEvent').mockResolvedValue([]); // Zero accepted relays

    await syncCoordinator.enqueueEvent('grp_rel_test3', 1501, {
      type: 'EXPENSE_CREATED',
      groupId: 'grp_rel_test3',
      expenseId: 'exp_rel_3',
      title: 'Taxi',
      amountCents: 500,
    });
    await syncCoordinator.processSyncQueue();

    const item = await db.sync_queue.where({ groupId: 'grp_rel_test3' }).first();
    expect(item).toBeDefined();
    expect(item?.status).toBe('RETRY_REQUIRED');
  });
});
