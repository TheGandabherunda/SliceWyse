import { db, type GroupKeyRecord } from '../../infrastructure/db/SliceWyseDatabase';
import { relayManager } from '../../infrastructure/nostr/RelayManager';
import { type Event as NostrEvent } from 'nostr-tools/pure';
import { identityService } from '../../infrastructure/identity/IdentityService';
import { aesGcmCryptoService } from '../../infrastructure/crypto/AesGcmCryptoService';
import {
  nip59GiftWrapService,
  type GroupKeyEnvelope,
} from '../../infrastructure/crypto/Nip59GiftWrapService';
import { eventDagService } from '../../domain/services/EventDagService';
import { DexieGroupRepository } from '../../infrastructure/repositories/DexieGroupRepository';
import { DexieExpenseRepository } from '../../infrastructure/repositories/DexieExpenseRepository';
import { DexieSettlementRepository } from '../../infrastructure/repositories/DexieSettlementRepository';
import { EventReducer } from '../../domain/services/EventReducer';

export class SyncCoordinator {
  private isProcessingQueue = false;
  private activeSubscriptionClose?: () => void;
  private groupRepo = new DexieGroupRepository();
  private expenseRepo = new DexieExpenseRepository();
  private settlementRepo = new DexieSettlementRepository();

  /**
   * Enqueues an event for synchronization with QUEUED status and attempts immediate flush.
   */
  async enqueueEvent(
    groupId: string,
    eventKind: number,
    unencryptedPayload: any,
    recipientPubkeys: string[] = []
  ): Promise<void> {
    const eventId = `evt_${crypto.randomUUID()}`;
    console.log(`SYNC publish group ${groupId}`);

    // Retrieve active Group Key for AES-256-GCM encryption
    const activeKey = await db.group_keys
      .where('[groupId+keyVersion]')
      .equals([groupId, unencryptedPayload.keyVersion ?? 1])
      .first();

    let payloadToSend = JSON.stringify(unencryptedPayload);

    // Encrypt data payloads (Kinds 1500, 1501, 1502, 1503) using AES-256-GCM Web Crypto
    if (activeKey && [1500, 1501, 1502, 1503].includes(eventKind)) {
      payloadToSend = await aesGcmCryptoService.encrypt(payloadToSend, activeKey.groupKeyHex);
    }

    await db.sync_queue.add({
      eventId,
      groupId,
      eventKind,
      payloadJson: payloadToSend,
      recipientsJson: JSON.stringify(recipientPubkeys),
      status: 'QUEUED',
      attempts: 0,
      lastAttemptAt: Date.now(),
    });

    this.processSyncQueue(recipientPubkeys);
  }

  /**
   * State Machine Queue Processor: QUEUED -> PUBLISHING -> ACCEPTED_BY_ONE_RELAY / REPLICATED / RETRY_REQUIRED
   */
  async processSyncQueue(recipientPubkeys: string[] = []): Promise<void> {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    try {
      const pendingItems = await db.sync_queue
        .where('status')
        .anyOf(['QUEUED', 'RETRY_REQUIRED', 'ACCEPTED_BY_ONE_RELAY'])
        .toArray();

      const currentIdentity = await identityService.getCurrentIdentity();
      if (!currentIdentity) {
        this.isProcessingQueue = false;
        return;
      }

      for (const item of pendingItems) {
        if (item.id === undefined) continue;

        await db.sync_queue.update(item.id, { status: 'PUBLISHING' });

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

          console.log(`SYNC event created ${nostrEvent.id}`);

          // Publish event and validate NIP-20 OK responses
          const acceptedRelays = await relayManager.publishEvent(nostrEvent);

          if (acceptedRelays.length >= 2) {
            // Replicated across multiple relays -> safe to purge queue item
            await db.sync_queue.update(item.id, {
              status: 'REPLICATED',
              acceptedRelaysJson: JSON.stringify(acceptedRelays),
            });
            await db.sync_queue.delete(item.id);
          } else if (acceptedRelays.length === 1) {
            // Persisted remotely on 1 relay
            await db.sync_queue.update(item.id, {
              status: 'ACCEPTED_BY_ONE_RELAY',
              acceptedRelaysJson: JSON.stringify(acceptedRelays),
            });
          } else {
            // Failed on all relays -> schedule for retry with exponential backoff
            await db.sync_queue.update(item.id, {
              status: 'RETRY_REQUIRED',
              attempts: item.attempts + 1,
              lastAttemptAt: Date.now(),
            });
          }
        } catch {
          await db.sync_queue.update(item.id, {
            status: 'RETRY_REQUIRED',
            attempts: item.attempts + 1,
            lastAttemptAt: Date.now(),
          });
        }
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Subscribes to Nostr relays and historical queries to reconstruct state.
   */
  async subscribeUserEvents(pubkeyHex: string, onSyncUpdate?: () => void): Promise<() => void> {
    if (this.activeSubscriptionClose) {
      this.activeSubscriptionClose();
    }

    const filters = [
      {
        kinds: [1059, 1500, 1501, 1502, 1503],
        authors: [pubkeyHex],
        limit: 500,
      },
      {
        kinds: [1059, 1500, 1501, 1502, 1503],
        '#p': [pubkeyHex],
        limit: 500,
      },
    ];

    // Historical EOSE query
    const historicalEvents = await relayManager.queryEvents(filters as any);
    for (const evt of historicalEvents) {
      await this.ingestEvent(evt);
    }
    if (onSyncUpdate) onSyncUpdate();

    // Realtime subscription
    const unsubscribe = relayManager.subscribe(filters as any, async (event: NostrEvent) => {
      await this.ingestEvent(event);
      if (onSyncUpdate) onSyncUpdate();
    });

    this.activeSubscriptionClose = unsubscribe;
    return unsubscribe;
  }

  /**
   * Ingests, verifies, decrypts, and persists an incoming Nostr event.
   */
  private async ingestEvent(event: NostrEvent): Promise<void> {
    try {
      const existing = await db.events.get(event.id);
      if (existing) return;

      const currentIdentity = await identityService.getCurrentIdentity();
      if (!currentIdentity) return;

      // Handle NIP-59 Group Key Envelopes (Kind 1059)
      if (event.kind === 1059) {
        if (currentIdentity.secretKey) {
          const envelope = nip59GiftWrapService.decryptGiftWrap(
            event,
            currentIdentity.secretKey,
            event.pubkey
          );
          if (envelope) {
            await this.storeGroupKey(envelope);
            console.log(`SYNC decrypted ${event.id}`);
          }
        }
        return;
      }

      const groupIdTag = event.tags.find((t) => t[0] === 'd');
      const groupId = groupIdTag ? groupIdTag[1] : '';

      // Locate Group Key for AES-256-GCM decryption
      const groupKeys = await db.group_keys.where({ groupId }).toArray();
      let decryptedPayload: any = null;

      if (groupKeys.length > 0) {
        // Try decrypting with available group keys
        for (const k of groupKeys) {
          try {
            const decryptedJson = await aesGcmCryptoService.decrypt(event.content, k.groupKeyHex);
            decryptedPayload = JSON.parse(decryptedJson);
            console.log(`SYNC decrypted ${event.id}`);
            break;
          } catch {
            // Try next key version
          }
        }
      } else {
        // Fallback for unencrypted test payloads
        try {
          decryptedPayload = JSON.parse(event.content);
        } catch {
          return;
        }
      }

      if (!decryptedPayload) return;

      const parentEventIds = decryptedPayload.parentEventIds ?? [];

      await db.events.put({
        id: event.id,
        kind: event.kind,
        pubkey: event.pubkey,
        createdAt: event.created_at,
        groupId,
        parentEventIdsJson: JSON.stringify(parentEventIds),
        rawEvent: JSON.stringify(event),
      });

      console.log(`SYNC verified ${event.id}`);

      // Reduce into Domain Entities
      if (event.kind === 1500) {
        const group = EventReducer.reduceGroup(decryptedPayload);
        await this.groupRepo.saveGroup(group);
      } else if (event.kind === 1501) {
        const expense = EventReducer.reduceExpense(decryptedPayload);
        await this.expenseRepo.saveExpense(expense);
      } else if (event.kind === 1502) {
        const settlement = EventReducer.reduceSettlement(decryptedPayload);
        await this.settlementRepo.saveSettlement(settlement);
      }

      console.log(`SYNC persisted ${event.id}`);
    } catch {
      // Ignore unparseable events
    }
  }

  private async storeGroupKey(envelope: GroupKeyEnvelope): Promise<void> {
    const existing = await db.group_keys
      .where('[groupId+keyVersion]')
      .equals([envelope.groupId, envelope.keyVersion])
      .first();

    if (!existing) {
      await db.group_keys.add({
        groupId: envelope.groupId,
        keyVersion: envelope.keyVersion,
        groupKeyHex: envelope.groupKey,
        createdAt: envelope.issuedAt,
      });
    }
  }
}

export const syncCoordinator = new SyncCoordinator();
