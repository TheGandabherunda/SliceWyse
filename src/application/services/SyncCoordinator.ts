import { db } from '../../infrastructure/db/SliceWyseDatabase';
import { relayManager } from '../../infrastructure/nostr/RelayManager';
import { finalizeEvent, type Event as NostrEvent } from 'nostr-tools/pure';
import { hexToBytes } from 'nostr-tools/utils';
import { identityService } from '../../infrastructure/identity/IdentityService';
import { EventReducer } from '../../domain/services/EventReducer';
import { DexieGroupRepository } from '../../infrastructure/repositories/DexieGroupRepository';
import { DexieExpenseRepository } from '../../infrastructure/repositories/DexieExpenseRepository';
import { DexieSettlementRepository } from '../../infrastructure/repositories/DexieSettlementRepository';

export class SyncCoordinator {
  private isProcessingQueue = false;
  private activeSubscriptionClose?: () => void;
  private groupRepo = new DexieGroupRepository();
  private expenseRepo = new DexieExpenseRepository();
  private settlementRepo = new DexieSettlementRepository();

  /**
   * Enqueues an event for offline synchronization and attempts immediate flush.
   */
  async enqueueEvent(
    groupId: string,
    eventKind: number,
    payloadJson: string,
    recipientPubkeys: string[] = []
  ): Promise<void> {
    const eventId = `evt_${crypto.randomUUID()}`;

    await db.sync_queue.add({
      eventId,
      groupId,
      eventKind,
      payloadJson,
      recipientsJson: JSON.stringify(recipientPubkeys),
      attempts: 0,
      lastAttemptAt: Date.now(),
    });

    this.processSyncQueue(recipientPubkeys);
  }

  /**
   * Flushes items in sync_queue to relays when network connection is available.
   */
  async processSyncQueue(recipientPubkeys: string[] = []): Promise<void> {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    try {
      const pendingItems = await db.sync_queue.toArray();
      const currentIdentity = await identityService.getCurrentIdentity();

      if (!currentIdentity) {
        this.isProcessingQueue = false;
        return;
      }

      for (const item of pendingItems) {
        try {
          const itemRecipients: string[] = item.recipientsJson
            ? JSON.parse(item.recipientsJson)
            : recipientPubkeys;

          const tags: string[][] = [
            ['d', item.groupId],
            ['e_id', item.eventId],
          ];

          for (const recipient of itemRecipients) {
            if (recipient && !tags.some((t) => t[0] === 'p' && t[1] === recipient)) {
              tags.push(['p', recipient]);
            }
          }

          const nostrEvent = await identityService.signEvent({
            kind: item.eventKind,
            created_at: Math.floor(Date.now() / 1000),
            tags,
            content: item.payloadJson,
          });

          const publishedRelays = await relayManager.publishEvent(nostrEvent);
          if (publishedRelays.length > 0 && item.id !== undefined) {
            await db.sync_queue.delete(item.id);
          } else if (item.id !== undefined) {
            await db.sync_queue.update(item.id, {
              attempts: item.attempts + 1,
              lastAttemptAt: Date.now(),
            });
          }
        } catch {
          // Keep in queue for next retry
        }
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Subscribes to Nostr relays for the user's groups, expenses, and settlements.
   * Reconstructs local IndexedDB state dynamically upon receiving Nostr events.
   */
  subscribeUserEvents(pubkeyHex: string, onSyncUpdate?: () => void): () => void {
    if (this.activeSubscriptionClose) {
      this.activeSubscriptionClose();
    }

    const filters = [
      {
        kinds: [30078, 30079, 30080, 30081],
        authors: [pubkeyHex],
        limit: 500,
      },
      {
        kinds: [30078, 30079, 30080, 30081],
        '#p': [pubkeyHex],
        limit: 500,
      },
    ];

    const unsubscribe = relayManager.subscribe(filters as any, async (event: NostrEvent) => {
      try {
        const existingEvent = await db.events.get(event.id);
        if (existingEvent) return;

        const groupIdTag = event.tags.find((t) => t[0] === 'd');
        const groupId = groupIdTag ? groupIdTag[1] : '';

        await db.events.put({
          id: event.id,
          kind: event.kind,
          pubkey: event.pubkey,
          createdAt: event.created_at,
          groupId,
          rawEvent: JSON.stringify(event),
        });

        const payload = JSON.parse(event.content);

        if (event.kind === 30078) {
          // Group state event
          const group = EventReducer.reduceGroup(payload);
          await this.groupRepo.saveGroup(group);
        } else if (event.kind === 30079) {
          // Expense event
          const expense = EventReducer.reduceExpense(payload);
          await this.expenseRepo.saveExpense(expense);
        } else if (event.kind === 30080) {
          // Settlement event
          const settlement = EventReducer.reduceSettlement(payload);
          await this.settlementRepo.saveSettlement(settlement);
        }

        if (onSyncUpdate) {
          onSyncUpdate();
        }
      } catch {
        // Ignore unparseable or irrelevant events
      }
    });

    this.activeSubscriptionClose = unsubscribe;
    return unsubscribe;
  }
}

export const syncCoordinator = new SyncCoordinator();
