import { db, type GroupKeyRecord } from '../../infrastructure/db/SliceWyseDatabase';
import { relayManager } from '../../infrastructure/nostr/RelayManager';
import { verifyEvent, type Event as NostrEvent } from 'nostr-tools/pure';
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

export type RecoveryState =
  | 'NOT_INITIALIZED'
  | 'RECOVERING_IDENTITY'
  | 'RECOVERING_GROUP_KEYS'
  | 'RECOVERING_EVENTS'
  | 'READY';

export class SyncCoordinator {
  private isProcessingQueue = false;
  private activeSubscriptionClose?: () => void;
  private groupRepo = new DexieGroupRepository();
  private expenseRepo = new DexieExpenseRepository();
  private settlementRepo = new DexieSettlementRepository();

  // Session & Deduplication State
  private activeSessionPubkey: string | null = null;
  private recoveryState: RecoveryState = 'NOT_INITIALIZED';
  private processedEventIds = new Set<string>();
  private updateListeners = new Set<() => void>();

  getRecoveryState(): RecoveryState {
    return this.recoveryState;
  }

  isHistorySyncing(): boolean {
    return (
      this.recoveryState === 'RECOVERING_IDENTITY' ||
      this.recoveryState === 'RECOVERING_GROUP_KEYS' ||
      this.recoveryState === 'RECOVERING_EVENTS'
    );
  }

  private setRecoveryState(state: RecoveryState): void {
    this.recoveryState = state;
    this.notifyListeners();
  }

  /**
   * Enqueues an application event pending construction/encryption and attempts immediate flush.
   */
  async enqueueEvent(
    groupId: string,
    eventKind: number,
    unencryptedPayload: any,
    recipientPubkeys: string[] = []
  ): Promise<void> {
    const eventId = `evt_${crypto.randomUUID()}`;

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

    await this.processSyncQueue(recipientPubkeys);
  }

  /**
   * Enqueues a fully constructed pre-signed Nostr event (e.g. NIP-59 Kind 1059 Gift Wrap).
   */
  async enqueueSignedEvent(
    signedEvent: NostrEvent,
    groupId: string,
    recipientPubkey: string
  ): Promise<void> {
    await db.sync_queue.add({
      eventId: signedEvent.id,
      groupId,
      eventKind: signedEvent.kind,
      payloadJson: signedEvent.content,
      signedNostrEventJson: JSON.stringify(signedEvent),
      recipientsJson: JSON.stringify([recipientPubkey]),
      status: 'QUEUED',
      attempts: 0,
      lastAttemptAt: Date.now(),
    });

    await this.processSyncQueue([recipientPubkey]);
  }

  /**
   * State Machine Queue Processor: QUEUED -> PUBLISHING -> ACCEPTED_BY_ONE_RELAY / REPLICATED / RETRY_REQUIRED.
   * Loops continuously until all queued items are processed to avoid race conditions between enqueued events.
   */
  async processSyncQueue(recipientPubkeys: string[] = []): Promise<void> {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    try {
      while (true) {
        const allQueueItems = await db.sync_queue.toArray();
        const pendingItems = allQueueItems.filter((item) => item.status === 'QUEUED');

        if (pendingItems.length === 0) {
          break;
        }

        const currentIdentity = await identityService.getCurrentIdentity();
        if (!currentIdentity) {
          break;
        }

        for (const item of pendingItems) {
          if (item.id === undefined) continue;

          await db.sync_queue.update(item.id, { status: 'PUBLISHING' });

          try {
            let nostrEventToPublish: NostrEvent;

            if (item.signedNostrEventJson) {
              nostrEventToPublish = JSON.parse(item.signedNostrEventJson) as NostrEvent;
            } else {
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

              nostrEventToPublish = await identityService.signEvent({
                kind: item.eventKind,
                created_at: Math.floor(Date.now() / 1000),
                tags,
                content: item.payloadJson,
              });
            }

            console.log(
              `SYNC publishing event before: kind=${nostrEventToPublish.kind} id=${nostrEventToPublish.id}`
            );

            const acceptedRelays = await relayManager.publishEvent(nostrEventToPublish);

            console.log(
              `SYNC publish result after: kind=${nostrEventToPublish.kind} id=${
                nostrEventToPublish.id
              } acceptedRelaysCount=${acceptedRelays.length} relays=${JSON.stringify(acceptedRelays)}`
            );

            if (acceptedRelays.length >= 2) {
              await db.sync_queue.update(item.id, {
                status: 'REPLICATED',
                acceptedRelaysJson: JSON.stringify(acceptedRelays),
              });
              await db.sync_queue.delete(item.id);
            } else if (acceptedRelays.length === 1) {
              await db.sync_queue.update(item.id, {
                status: 'ACCEPTED_BY_ONE_RELAY',
                acceptedRelaysJson: JSON.stringify(acceptedRelays),
              });
            } else {
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
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Subscribes to user events with idempotent session management and in-flight historical sync guard.
   */
  async subscribeUserEvents(pubkeyHex: string, onSyncUpdate?: () => void): Promise<() => void> {
    if (onSyncUpdate) {
      this.updateListeners.add(onSyncUpdate);
    }

    const unsubscribeListener = () => {
      if (onSyncUpdate) {
        this.updateListeners.delete(onSyncUpdate);
      }
    };

    if (this.activeSessionPubkey === pubkeyHex) {
      console.log(`SYNC session already active ${pubkeyHex}`);
      return unsubscribeListener;
    }

    if (this.activeSessionPubkey && this.activeSessionPubkey !== pubkeyHex) {
      this.stopSession();
    }

    this.activeSessionPubkey = pubkeyHex;
    console.log(`SYNC session start ${pubkeyHex}`);

    await this.runHistoricalSync(pubkeyHex);

    return unsubscribeListener;
  }

  /**
   * Executes 4-Stage Historical Synchronization ONCE under in-flight guard.
   */
  private async runHistoricalSync(pubkeyHex: string): Promise<void> {
    if (this.isHistorySyncing()) return;

    console.log(`SYNC history start ${pubkeyHex}`);
    const currentIdentity = await identityService.getCurrentIdentity();

    try {
      // Stage 1: Retrieve NIP-59 Gift Wrap events addressed to current identity (#p: [pubkeyHex])
      this.setRecoveryState('RECOVERING_IDENTITY');
      const giftWrapFilters = [{ kinds: [1059], '#p': [pubkeyHex], limit: 500 }];
      const giftWrapEvents = await relayManager.queryEvents(giftWrapFilters as any);
      console.log(
        `SYNC Stage 1: total Gift Wrap (Kind 1059) events fetched from relays: ${giftWrapEvents.length}`
      );

      for (const gwEvent of giftWrapEvents) {
        await this.ingestEvent(gwEvent);
      }

      // Stage 2: Discover all group IDs from stored group keys
      this.setRecoveryState('RECOVERING_GROUP_KEYS');
      const storedKeys = await db.group_keys.toArray();
      const groupIds = Array.from(new Set(storedKeys.map((k) => k.groupId)));

      // Stage 3: Query Group State events (Kind 1500-1503) via #d, #p, and authors filters
      if (groupIds.length > 0) {
        const groupFilters = [
          { kinds: [1500, 1501, 1502, 1503], '#d': groupIds, limit: 500 },
          { kinds: [1500, 1501, 1502, 1503], '#p': [pubkeyHex], limit: 500 },
          { kinds: [1500, 1501, 1502, 1503], authors: [pubkeyHex], limit: 500 },
        ];
        const groupEvents = await relayManager.queryEvents(groupFilters as any);
        for (const evt of groupEvents) {
          await this.ingestEvent(evt);
        }

        const allMembers = await db.members.toArray();
        const memberPubkeys = Array.from(new Set(allMembers.map((m) => m.pubkey)));
        for (const memberPk of memberPubkeys) {
          await relayManager.fetchAndMergeNip65Relays(memberPk);
        }
      }

      // Stage 4: Query multi-author history across all member write relays and bootstrap relays
      this.setRecoveryState('RECOVERING_EVENTS');
      const dataFilters = [
        { kinds: [1500, 1501, 1502, 1503], authors: [pubkeyHex], limit: 500 },
        { kinds: [1500, 1501, 1502, 1503], '#p': [pubkeyHex], limit: 500 },
      ];

      if (groupIds.length > 0) {
        dataFilters.push({ kinds: [1500, 1501, 1502, 1503], '#d': groupIds, limit: 500 } as any);
      }

      const dataEvents = await relayManager.queryEvents(dataFilters as any);
      for (const evt of dataEvents) {
        await this.ingestEvent(evt);
      }

      // Start Realtime Subscription after history sync completes
      if (this.activeSubscriptionClose) {
        this.activeSubscriptionClose();
      }

      const subId = `sub_${pubkeyHex.slice(0, 8)}`;
      console.log(`SYNC subscription created ${subId}`);

      const unsubscribe = relayManager.subscribe(dataFilters as any, async (event: NostrEvent) => {
        await this.ingestEvent(event);
        this.notifyListeners();
      });

      this.activeSubscriptionClose = () => {
        console.log(`SYNC subscription closed ${subId}`);
        unsubscribe();
      };

      console.log(`SYNC history complete ${pubkeyHex}`);
    } finally {
      this.setRecoveryState('READY');
    }
  }

  /**
   * Stops current active sync session and cleans up subscriptions/listeners.
   */
  stopSession(): void {
    if (this.activeSessionPubkey) {
      console.log(`SYNC session stop ${this.activeSessionPubkey}`);
      this.activeSessionPubkey = null;
    }
    if (this.activeSubscriptionClose) {
      this.activeSubscriptionClose();
      this.activeSubscriptionClose = undefined;
    }
    this.updateListeners.clear();
    this.processedEventIds.clear();
    this.setRecoveryState('NOT_INITIALIZED');
  }

  private notifyListeners(): void {
    for (const listener of Array.from(this.updateListeners)) {
      try {
        listener();
      } catch {
        // Ignore listener exceptions
      }
    }
  }

  /**
   * Ingests, verifies signatures, decrypts AES-256-GCM, and persists an incoming Nostr event.
   * Fully instrumented with post-verification diagnostics and error boundaries.
   */
  private async ingestEvent(event: NostrEvent): Promise<void> {
    console.log(`SYNC enter event processing ${event.id} ${event.kind}`);

    // 1. Event-Level Deduplication before crypto processing
    if (this.processedEventIds.has(event.id)) {
      console.log(`SYNC early return: duplicate ignored ${event.id}`);
      return;
    }
    this.processedEventIds.add(event.id);

    try {
      const existing = await db.events.get(event.id);
      if (existing) {
        console.log(`SYNC early return: event already in DB ${event.id}`);
        return;
      }

      // 2. Signature Verification
      if (!verifyEvent(event)) {
        console.log(`SYNC early return: signature verification failed ${event.id}`);
        return;
      }
      console.log(`SYNC signature verified ${event.id}`);

      // POST-SIGNATURE VERIFICATION PIPELINE
      const currentIdentity = await identityService.getCurrentIdentity();
      if (!currentIdentity) {
        console.log(`SYNC early return: no current identity ${event.id}`);
        return;
      }

      // Handle Gift Wrap (Kind 1059)
      if (event.kind === 1059) {
        if (currentIdentity.secretKey) {
          console.log(`SYNC beginning giftwrap unwrap ${event.id}`);
          const unwrapped = nip59GiftWrapService.decryptGiftWrap(event, currentIdentity.secretKey);
          if (unwrapped) {
            console.log(`SYNC giftwrap unwrapped ${event.id}`);
            console.log(
              `SYNC group key recovered ${unwrapped.envelope.groupId} ${unwrapped.envelope.keyVersion}`
            );
            await this.storeGroupKey(unwrapped.envelope);
          } else {
            console.log(`SYNC early return: giftwrap decrypt returned null ${event.id}`);
          }
        } else {
          console.log(`SYNC early return: no secretKey for giftwrap ${event.id}`);
        }
        return;
      }

      // 4. Extracted groupId
      const groupIdTag = event.tags.find((t) => t[0] === 'd');
      const groupId = groupIdTag ? groupIdTag[1] : '';
      console.log(`SYNC extracted groupId ${groupId || 'EMPTY'} for ${event.id}`);

      if (!groupId) {
        console.log(`SYNC early return: missing groupId ${event.id}`);
        return;
      }

      // 6. Looking up group key in Dexie DB
      console.log(`SYNC looking up group key ${groupId}`);
      const groupKeys = await db.group_keys.where('groupId').equals(groupId).toArray();
      let decryptedPayload: any = null;

      if (groupKeys.length > 0) {
        console.log(`SYNC group key found ${groupId} (count: ${groupKeys.length})`);
        console.log(`SYNC beginning payload decryption ${event.id}`);

        for (const k of groupKeys) {
          try {
            const decryptedJson = await aesGcmCryptoService.decrypt(event.content, k.groupKeyHex);
            console.log(`SYNC decryption succeeded ${event.id}`);
            console.log(`SYNC beginning JSON parse ${event.id}`);
            decryptedPayload = JSON.parse(decryptedJson);
            console.log(`SYNC JSON parse succeeded ${event.id}`);
            console.log(
              `SYNC extracted key version ${decryptedPayload.keyVersion ?? k.keyVersion} for ${event.id}`
            );
            break;
          } catch (decryptErr: any) {
            console.log(
              `SYNC decrypt failed for key version ${k.keyVersion} on ${event.id}: ${
                decryptErr?.message || String(decryptErr)
              }`
            );
          }
        }
      } else {
        console.log(`SYNC group key not found ${groupId}`);
        console.log(`SYNC attempting plaintext JSON parse fallback for ${event.id}`);
        try {
          decryptedPayload = JSON.parse(event.content);
          console.log(`SYNC JSON parse succeeded for fallback ${event.id}`);
        } catch (jsonErr: any) {
          console.log(
            `SYNC early return: JSON parse failed for fallback ${event.id}: ${
              jsonErr?.message || String(jsonErr)
            }`
          );
          return;
        }
      }

      if (!decryptedPayload) {
        console.log(`SYNC early return: decrypt failed / no valid payload ${event.id}`);
        return;
      }

      // 12. Beginning domain model reconstruction
      console.log(`SYNC beginning domain model reconstruction ${event.id}`);
      const parentEventIds = decryptedPayload.parentEventIds ?? [];

      // 13. Beginning persistence to IndexedDB
      console.log(`SYNC beginning persistence ${event.id}`);

      await db.events.put({
        id: event.id,
        kind: event.kind,
        pubkey: event.pubkey,
        createdAt: event.created_at,
        groupId,
        parentEventIdsJson: JSON.stringify(parentEventIds),
        rawEvent: JSON.stringify(event),
      });

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
      } else {
        console.log(`SYNC early return: unsupported event kind ${event.kind} for ${event.id}`);
        return;
      }

      // 14. Persistence succeeded
      console.log(`SYNC persisted ${event.id}`);

      // 15. UI/store listeners notified
      console.log(`SYNC listeners notified ${event.id}`);
      this.notifyListeners();

      // 16. Event processing completed successfully
      console.log(`SYNC event processing completed ${event.id}`);
    } catch (error: any) {
      console.error(
        `SYNC event processing error ${event.id} ${event.kind}: ${error?.message || String(error)}`,
        error?.stack
      );
    }
  }

  /**
   * Idempotent storage of Group Keys.
   * If the exact same (groupId, keyVersion, groupKeyHex) exists, returns without writing or triggering listeners.
   */
  private async storeGroupKey(envelope: GroupKeyEnvelope): Promise<void> {
    const existing = await db.group_keys
      .where('[groupId+keyVersion]')
      .equals([envelope.groupId, envelope.keyVersion])
      .first();

    if (existing) {
      if (existing.groupKeyHex === envelope.groupKey) {
        return; // Idempotent match - do not re-write or trigger updates
      }
    } else {
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
