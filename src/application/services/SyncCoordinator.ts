import { db } from '../../infrastructure/db/SliceWyseDatabase';
import { relayManager } from '../../infrastructure/nostr/RelayManager';
import { type Event as NostrEvent } from 'nostr-tools/pure';
import { identityService } from '../../infrastructure/identity/IdentityService';
import { nip44CryptoService } from '../../infrastructure/crypto/Nip44CryptoService';
import {
  EventReducer,
  type DecryptedExpensePayload,
  type DecryptedGroupPayload,
  type DecryptedSettlementPayload,
} from '../../domain/services/EventReducer';
import { DexieGroupRepository } from '../../infrastructure/repositories/DexieGroupRepository';
import { DexieExpenseRepository } from '../../infrastructure/repositories/DexieExpenseRepository';
import { DexieSettlementRepository } from '../../infrastructure/repositories/DexieSettlementRepository';

export class SyncCoordinator {
  private isProcessingQueue = false;
  private queueProcessRequested = false;
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

    void this.processSyncQueue();
  }

  /**
   * Flushes items in sync_queue to relays when network connection is available.
   */
  async processSyncQueue(): Promise<void> {
    this.queueProcessRequested = true;
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    try {
      const currentIdentity = await identityService.getCurrentIdentity();

      if (!currentIdentity) {
        return;
      }

      do {
        this.queueProcessRequested = false;
        const pendingItems = await db.sync_queue.toArray();

        for (const item of pendingItems) {
          try {
            const itemRecipients: string[] = item.recipientsJson
              ? JSON.parse(item.recipientsJson)
              : [];

            const tags: string[][] = [
              ['d', item.groupId],
              ['e_id', item.eventId],
            ];

            for (const recipient of itemRecipients) {
              if (recipient && !tags.some((t) => t[0] === 'p' && t[1] === recipient)) {
                tags.push(['p', recipient]);
              }
            }

            const encryptedContent = await this.encryptForRecipients(item.payloadJson, itemRecipients);

            const nostrEvent = await identityService.signEvent({
              kind: item.eventKind,
              created_at: Math.floor(Date.now() / 1000),
              tags,
              content: encryptedContent,
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
      } while (this.queueProcessRequested);
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

        const payload = await this.decryptEventPayload(event.content, event.pubkey);
        if (!payload) return;

        if (event.kind === 30078) {
          // Group state event
          const group = EventReducer.reduceGroup(payload as unknown as DecryptedGroupPayload);
          await this.groupRepo.saveGroup(group);
        } else if (event.kind === 30079) {
          // Expense event
          const expense = EventReducer.reduceExpense(payload as unknown as DecryptedExpensePayload);
          await this.expenseRepo.saveExpense(expense);
        } else if (event.kind === 30080) {
          // Settlement event
          const settlement = EventReducer.reduceSettlement(payload as unknown as DecryptedSettlementPayload);
          await this.settlementRepo.saveSettlement(settlement);
        }

        // Only mark an event handled after it has been decrypted and reduced. This allows a later
        // retry if an extension was temporarily unable to perform NIP-44 decryption.
        await db.events.put({
          id: event.id,
          kind: event.kind,
          pubkey: event.pubkey,
          createdAt: event.created_at,
          groupId,
          rawEvent: JSON.stringify(event),
        });

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

  /**
   * Encrypts one copy of the payload for every group recipient, including the signing identity.
   * The self-encrypted copy is what lets the same account read its events in another browser.
   */
  private async encryptForRecipients(payloadJson: string, recipients: string[]): Promise<string> {
    const identity = await identityService.getCurrentIdentity();
    if (!identity) throw new Error('User identity required to encrypt sync event');

    const recipientPubkeys = [
      ...new Set([...recipients, identity.pubkey].map((pubkey) => pubkey.toLowerCase())),
    ];
    const encrypted: Record<string, string> = {};

    for (const recipientPubkey of recipientPubkeys) {
      if (identity.secretKey) {
        const conversationKey = nip44CryptoService.getConversationKey(identity.secretKey, recipientPubkey);
        encrypted[recipientPubkey] = nip44CryptoService.encrypt(payloadJson, conversationKey);
      } else if (identity.isExtension && typeof window !== 'undefined' && window.nostr?.nip44) {
        encrypted[recipientPubkey] = await window.nostr.nip44.encrypt(recipientPubkey, payloadJson);
      } else {
        throw new Error('This NIP-07 extension does not support NIP-44 encryption');
      }
    }

    return JSON.stringify({ v: 2, encryption: 'nip44', encrypted });
  }

  private async decryptEventPayload(
    content: string,
    authorPubkey: string
  ): Promise<Record<string, unknown> | null> {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    const envelope = parsed as { encryption?: unknown; encrypted?: unknown };
    if (envelope.encryption !== 'nip44' || !envelope.encrypted || typeof envelope.encrypted !== 'object') {
      // Events published before encrypted envelopes were introduced remain readable. New events
      // are always written through encryptForRecipients above and never expose this payload.
      return parsed as Record<string, unknown>;
    }

    const identity = await identityService.getCurrentIdentity();
    if (!identity) return null;

    const encrypted = envelope.encrypted as Record<string, unknown>;
    const ciphertext = Object.entries(encrypted).find(
      ([pubkey]) => pubkey.toLowerCase() === identity.pubkey.toLowerCase()
    )?.[1];
    if (typeof ciphertext !== 'string') return null;

    let plaintext: string;
    if (identity.secretKey) {
      const conversationKey = nip44CryptoService.getConversationKey(identity.secretKey, authorPubkey);
      plaintext = nip44CryptoService.decrypt(ciphertext, conversationKey);
    } else if (identity.isExtension && typeof window !== 'undefined' && window.nostr?.nip44) {
      plaintext = await window.nostr.nip44.decrypt(authorPubkey, ciphertext);
    } else {
      return null;
    }

    const payload: unknown = JSON.parse(plaintext);
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  }
}

export const syncCoordinator = new SyncCoordinator();
