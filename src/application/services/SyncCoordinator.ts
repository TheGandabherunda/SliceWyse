import { db } from '../../infrastructure/db/SliceWyseDatabase';
import { relayManager } from '../../infrastructure/nostr/RelayManager';
import { finalizeEvent } from 'nostr-tools/pure';
import { hexToBytes } from 'nostr-tools/utils';
import { identityService } from '../../infrastructure/identity/IdentityService';

export class SyncCoordinator {
  private isProcessingQueue = false;

  /**
   * Enqueues an event for offline synchronization and attempts immediate flush.
   */
  async enqueueEvent(groupId: string, eventKind: number, payloadJson: string): Promise<void> {
    const eventId = `evt_${crypto.randomUUID()}`;

    await db.sync_queue.add({
      eventId,
      groupId,
      eventKind,
      payloadJson,
      attempts: 0,
      lastAttemptAt: Date.now(),
    });

    this.processSyncQueue();
  }

  /**
   * Flushes items in sync_queue to relays when network connection is available.
   */
  async processSyncQueue(): Promise<void> {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    try {
      const pendingItems = await db.sync_queue.toArray();
      const currentIdentity = await identityService.getCurrentIdentity();

      if (!currentIdentity || !currentIdentity.secretKey) {
        this.isProcessingQueue = false;
        return;
      }

      const secretKeyBytes = hexToBytes(currentIdentity.secretKey);

      for (const item of pendingItems) {
        try {
          const nostrEvent = finalizeEvent(
            {
              kind: item.eventKind,
              created_at: Math.floor(Date.now() / 1000),
              tags: [
                ['d', item.groupId],
                ['e_id', item.eventId],
              ],
              content: item.payloadJson,
            },
            secretKeyBytes
          );

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
          // Keep in queue for next sync attempt
        }
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }
}

export const syncCoordinator = new SyncCoordinator();
