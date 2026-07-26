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
import {
  EventValidationPipeline,
  type ValidatedEvent,
} from '../../domain/services/EventValidationPipeline';
import { Group } from '../../domain/entities/Group';
import { Member } from '../../domain/entities/Member';
import { Pubkey } from '../../domain/value-objects/Pubkey';
import { FulfillJoinRequestUseCase } from '../use-cases/FulfillJoinRequestUseCase';
import { orphanBuffer } from '../../domain/services/OrphanBuffer';

export type RecoveryState =
  | 'NOT_INITIALIZED'
  | 'RECOVERING_IDENTITY'
  | 'RECOVERING_GROUP_KEYS'
  | 'RECOVERING_EVENTS'
  | 'READY';

export interface SubmitLocalEventOptions<T = any> {
  groupId: string;
  eventKind: number;
  unencryptedPayload: T;
  parentEventIds: string[];
  recipientPubkeys?: string[];
  keyVersion?: number;
}

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

  subscribe(listener: () => void): () => void {
    this.updateListeners.add(listener);
    return () => {
      this.updateListeners.delete(listener);
    };
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
   * Category A: Domain State-Mutating Local Event Submission API (ADR-005).
   * Performs prerequisite checks, encrypts payload, signs event, validates via canonical EventValidationPipeline,
   * persists to db.events, reduces to domain projections, and queues for relay transmission in a single atomic transaction.
   */
  async submitLocalEvent<T = any>(options: SubmitLocalEventOptions<T>): Promise<ValidatedEvent> {
    const {
      groupId,
      eventKind,
      unencryptedPayload,
      parentEventIds,
      recipientPubkeys = [],
    } = options;

    // 1. PREREQUISITE CHECKS (Non-validation checks)
    const currentIdentity = await identityService.getCurrentIdentity();
    if (!currentIdentity) {
      throw new Error('User identity required to submit local event');
    }

    const requestedKeyVersion = (unencryptedPayload as any)?.keyVersion ?? options.keyVersion;
    const activeKey = requestedKeyVersion
      ? await this.getGroupKey(groupId, requestedKeyVersion)
      : await this.getLatestGroupKey(groupId);

    const usedKeyVersion = activeKey?.keyVersion ?? requestedKeyVersion ?? 1;

    let payloadToSend =
      typeof unencryptedPayload === 'string'
        ? unencryptedPayload
        : JSON.stringify(unencryptedPayload);

    // Encrypt data payloads (Kinds 1500, 1501, 1502, 1503) using AES-256-GCM
    if ([1500, 1501, 1502, 1503].includes(eventKind)) {
      if (!activeKey) {
        throw new Error(
          `Group key required to encrypt event kind ${eventKind} for group ${groupId}`
        );
      }
      payloadToSend = await aesGcmCryptoService.encrypt(payloadToSend, activeKey.groupKeyHex);
    }

    // 2. CONSTRUCT NOSTR EVENT TAGS (Protocol compliant, no custom eventId tag)
    const tags: string[][] = [
      ['d', groupId],
      ['k', String(usedKeyVersion)],
    ];

    for (const parentId of parentEventIds) {
      if (parentId) {
        tags.push(['e', parentId]);
      }
    }

    for (const recipient of recipientPubkeys) {
      if (recipient && !tags.some((t) => t[0] === 'p' && t[1] === recipient)) {
        tags.push(['p', recipient]);
      }
    }

    // 3. SIGN NOSTR EVENT
    const signedNostrEvent = await identityService.signEvent({
      kind: eventKind,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: payloadToSend,
    });

    // Mark event ID as processed locally to ensure O(1) synchronous self-echo deduplication
    this.processedEventIds.add(signedNostrEvent.id);

    // 4. CANONICAL PIPELINE VALIDATION (Executed exactly once for local and remote events)
    const validated = await EventValidationPipeline.validateAndDecryptEvent(
      signedNostrEvent,
      async (gId: string) => db.group_keys.where('groupId').equals(gId).toArray()
    );

    if (!validated.isValid) {
      throw new Error(`Local event validation failed: ${validated.error}`);
    }

    // 5. ATOMIC DEXIE TRANSACTION ('rw', [events, sync_queue, groups, members, expenses, settlements, group_keys, identities])
    await db.transaction(
      'rw',
      [
        db.events,
        db.sync_queue,
        db.groups,
        db.members,
        db.expenses,
        db.settlements,
        db.group_keys,
        db.identities,
      ],
      async () => {
        // A. Persist signed Nostr event to db.events
        await db.events.put({
          id: signedNostrEvent.id,
          kind: signedNostrEvent.kind,
          pubkey: signedNostrEvent.pubkey,
          createdAt: signedNostrEvent.created_at,
          groupId,
          parentEventIdsJson: JSON.stringify(validated.parentEventIds),
          rawEvent: JSON.stringify(signedNostrEvent),
          keyVersion: usedKeyVersion,
        });

        // B. Reduce onto Domain Projections (calls persistAndReduceValidatedEvent)
        await this.persistAndReduceValidatedEvent(validated);

        // C. Queue for Relay Transmission
        await db.sync_queue.add({
          eventId: signedNostrEvent.id,
          groupId,
          eventKind,
          keyVersion: usedKeyVersion,
          payloadJson: payloadToSend,
          signedNostrEventJson: JSON.stringify(signedNostrEvent),
          recipientsJson: JSON.stringify(recipientPubkeys),
          status: 'QUEUED',
          attempts: 0,
          lastAttemptAt: Date.now(),
        });
      }
    );

    // 6. UI NOTIFICATION & ASYNC RELAY FLUSH
    this.notifyListeners();
    void this.processSyncQueue(recipientPubkeys);

    return validated;
  }

  /**
   * Category B: Operational Signaling Local Event Publication API (ADR-005).
   * Signs and queues operational signals (JOIN_REQUEST Kind 1504, SYNC_REQUEST Kind 1505)
   * for relay broadcast WITHOUT invoking EventReducer.
   */
  async publishSignalEvent<T = any>(options: SubmitLocalEventOptions<T>): Promise<string> {
    const {
      groupId,
      eventKind,
      unencryptedPayload,
      parentEventIds = [],
      recipientPubkeys = [],
    } = options;

    const currentIdentity = await identityService.getCurrentIdentity();
    if (!currentIdentity) {
      throw new Error('User identity required to publish signal event');
    }

    const payloadToSend =
      typeof unencryptedPayload === 'string'
        ? unencryptedPayload
        : JSON.stringify(unencryptedPayload);

    const tags: string[][] = [['d', groupId]];

    const version = options.keyVersion ?? (unencryptedPayload as any)?.keyVersion;
    if (version) {
      tags.push(['k', String(version)]);
    }

    for (const parentId of parentEventIds) {
      if (parentId) {
        tags.push(['e', parentId]);
      }
    }

    for (const recipient of recipientPubkeys) {
      if (recipient && !tags.some((t) => t[0] === 'p' && t[1] === recipient)) {
        tags.push(['p', recipient]);
      }
    }

    const signedNostrEvent = await identityService.signEvent({
      kind: eventKind,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: payloadToSend,
    });

    // Mark event ID as processed locally to ensure O(1) synchronous self-echo deduplication
    this.processedEventIds.add(signedNostrEvent.id);

    await db.sync_queue.add({
      eventId: signedNostrEvent.id,
      groupId,
      eventKind,
      keyVersion: version,
      payloadJson: payloadToSend,
      signedNostrEventJson: JSON.stringify(signedNostrEvent),
      recipientsJson: JSON.stringify(recipientPubkeys),
      status: 'QUEUED',
      attempts: 0,
      lastAttemptAt: Date.now(),
    });

    void this.processSyncQueue(recipientPubkeys);

    return signedNostrEvent.id;
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
    const activeKey = unencryptedPayload.keyVersion
      ? await this.getGroupKey(groupId, unencryptedPayload.keyVersion)
      : await this.getLatestGroupKey(groupId);

    const usedKeyVersion = activeKey?.keyVersion ?? unencryptedPayload.keyVersion ?? 1;

    let payloadToSend = JSON.stringify(unencryptedPayload);

    // Encrypt data payloads (Kinds 1500, 1501, 1502, 1503) using AES-256-GCM Web Crypto
    if (activeKey && [1500, 1501, 1502, 1503].includes(eventKind)) {
      payloadToSend = await aesGcmCryptoService.encrypt(payloadToSend, activeKey.groupKeyHex);
    }

    await db.sync_queue.add({
      eventId,
      groupId,
      eventKind,
      keyVersion: usedKeyVersion,
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

              if (item.keyVersion) {
                tags.push(['k', String(item.keyVersion)]);
              }

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
    console.log(
      `[PIPELINE-1504-1500] STEP 6: SyncCoordinator.ingestEvent received kind=${event.kind} id=${event.id} from pubkey=${event.pubkey}`
    );

    // 1. Two-Tier Event Deduplication Architecture (ADR-005 Commit 1B)
    // Tier 1: Synchronous O(1) in-memory hot cache for active session & self-authored events
    if (this.processedEventIds.has(event.id)) {
      console.log(`SYNC early return: duplicate ignored (Tier 1 hot cache) ${event.id}`);
      return;
    }
    this.processedEventIds.add(event.id);

    try {
      // Tier 2: Persistent IndexedDB cold storage lookup for multi-tab / post-restart sessions
      const existing = await db.events.get(event.id);
      if (existing) {
        console.log(`SYNC early return: duplicate ignored (Tier 2 DB store) ${event.id}`);
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

      // Run 8-Step Event Validation Pipeline (Steps 1 through 7)
      const validated = await EventValidationPipeline.validateAndDecryptEvent(
        event,
        async (groupId: string) => db.group_keys.where('groupId').equals(groupId).toArray()
      );

      if (!validated.isValid) {
        console.log(`SYNC early return: ${validated.error} ${event.id}`);
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

      // Check if all parentEventIds are present in IndexedDB storage
      if (validated.parentEventIds.length > 0) {
        let hasMissingParents = false;
        for (const pId of validated.parentEventIds) {
          const parentExists = await db.events.get(pId);
          if (!parentExists) {
            hasMissingParents = true;
            break;
          }
        }

        if (hasMissingParents) {
          console.log(`SYNC event buffered in orphan queue waiting for parents: ${event.id}`);
          orphanBuffer.addOrphan(validated);
          return;
        }
      }

      await this.persistAndReduceValidatedEvent(validated);
      await this.drainOrphanBuffer();
    } catch (error: any) {
      console.error(
        `SYNC event processing error ${event.id} ${event.kind}: ${error?.message || String(error)}`,
        error?.stack
      );
    }
  }

  private async persistAndReduceValidatedEvent(validated: ValidatedEvent): Promise<void> {
    const { event, groupId, payload, parentEventIds } = validated;

    console.log(
      `[PIPELINE-1504-1500] STEP 10: SyncCoordinator.persistAndReduceValidatedEvent reducing kind=${event.kind} id=${event.id} type=${payload?.type}`
    );

    await db.events.put({
      id: event.id,
      kind: event.kind,
      pubkey: event.pubkey,
      createdAt: event.created_at,
      groupId,
      parentEventIdsJson: JSON.stringify(parentEventIds),
      rawEvent: JSON.stringify(event),
    });

    // Reduce into Domain Entities via Pure Reducers
    if (event.kind === 1500) {
      const type = payload?.type;
      if (type === 'GROUP_CREATED') {
        const group = EventReducer.reduceGroup(payload);
        await this.groupRepo.saveGroup(group);
      } else if (type === 'GROUP_UPDATED') {
        const currentGroup = await this.groupRepo.getGroupById(groupId);
        if (currentGroup) {
          const updated = EventReducer.reduceGroupUpdate(currentGroup, payload);
          await this.groupRepo.saveGroup(updated);
        }
      } else if (type === 'MEMBERSHIP_ADDED') {
        const currentGroup = await this.groupRepo.getGroupById(groupId);
        if (currentGroup) {
          const updated = EventReducer.reduceMembershipAdd(currentGroup, payload);
          await this.groupRepo.saveGroup(updated);
        }
      } else if (type === 'MEMBERSHIP_REMOVED') {
        const currentGroup = await this.groupRepo.getGroupById(groupId);
        if (currentGroup) {
          const updated = EventReducer.reduceMembershipRemove(currentGroup, payload);
          await this.groupRepo.saveGroup(updated);
        }
      } else {
        const group = EventReducer.reduceGroup(payload);
        await this.groupRepo.saveGroup(group);
      }
    } else if (event.kind === 1501) {
      const type = payload?.type;
      const expenseId = payload?.id ?? payload?.expenseId;

      if (type === 'EXPENSE_UPDATED') {
        if (expenseId) {
          const currentExpense = await this.expenseRepo.getExpenseById(expenseId);
          if (currentExpense) {
            const updated = EventReducer.reduceExpenseUpdate(currentExpense, payload);
            await this.expenseRepo.saveExpense(updated);
          }
        }
      } else if (type === 'EXPENSE_DELETED') {
        if (expenseId) {
          const currentExpense = await this.expenseRepo.getExpenseById(expenseId);
          if (currentExpense) {
            const updated = EventReducer.reduceExpenseDelete(currentExpense, payload);
            await this.expenseRepo.saveExpense(updated);
          }
        }
      } else if (type === 'EXPENSE_CREATED' || !type) {
        const expense = EventReducer.reduceExpense(payload);
        await this.expenseRepo.saveExpense(expense);
      }
    } else if (event.kind === 1502) {
      const type = payload?.type;
      const settlementId = payload?.id;
      if (type === 'SETTLEMENT_DELETED' && settlementId) {
        const currentSettlement = await this.settlementRepo.getSettlementById(settlementId);
        if (currentSettlement) {
          const updated = EventReducer.reduceSettlementDelete(currentSettlement, payload);
          await this.settlementRepo.saveSettlement(updated);
        }
      } else {
        const settlement = EventReducer.reduceSettlement(payload);
        await this.settlementRepo.saveSettlement(settlement);
      }
    } else if (event.kind === 1504) {
      await this.handleJoinRequest(event.pubkey, payload);
    } else if (event.kind === 1505) {
      await this.handleSyncRequest(event.pubkey, payload);
    } else {
      console.log(`SYNC early return: unsupported event kind ${event.kind} for ${event.id}`);
      return;
    }

    console.log(`SYNC persisted ${event.id}`);
    this.notifyListeners();
  }

  /**
   * Publishes a Kind 1504 JOIN_REQUEST event to online group members.
   */
  async sendJoinRequest(
    groupId: string,
    invitationKeyVersion: number,
    recipientPubkeys: string[]
  ): Promise<void> {
    const currentIdentity = await identityService.getCurrentIdentity();
    if (!currentIdentity) return;

    const payload = {
      type: 'JOIN_REQUEST',
      groupId,
      joiningMember: {
        pubkey: currentIdentity.pubkey,
        displayName: currentIdentity.displayName,
        joinedAt: Date.now(),
      },
      invitationKeyVersion,
      requestedAt: Date.now(),
    };

    await this.enqueueEvent(groupId, 1504, payload, recipientPubkeys);
  }

  /**
   * Online member auto-fulfillment handler for Kind 1504 JOIN_REQUEST.
   * Delegates fulfillment decision and execution to FulfillJoinRequestUseCase.
   */
  async handleJoinRequest(joiningPubkey: string, payload: any): Promise<void> {
    const { groupId, joiningMember, invitationKeyVersion } = payload;

    const fulfillUseCase = new FulfillJoinRequestUseCase(this.groupRepo);
    await fulfillUseCase.execute({
      groupId,
      joiningPubkey,
      joiningMember,
      invitationKeyVersion,
    });
  }

  /**
   * Publishes a Kind 1505 SYNC_REQUEST to catch up on missed group events and key envelopes.
   */
  async requestHistoricalSync(
    groupId: string,
    recipientPubkeys: string[],
    sinceKeyVersion?: number
  ): Promise<void> {
    const localEvents = await db.events.where('groupId').equals(groupId).toArray();
    const knownEventIds = localEvents.map((e) => e.id);

    const payload = {
      type: 'SYNC_REQUEST',
      groupId,
      sinceKeyVersion,
      knownEventIds,
      requestedAt: Date.now(),
    };

    await this.enqueueEvent(groupId, 1505, payload, recipientPubkeys);
  }

  /**
   * Responds to a Kind 1505 SYNC_REQUEST by validating the requester and re-sending missing key envelopes & events.
   */
  async handleSyncRequest(requesterPubkey: string, payload: any): Promise<void> {
    const { groupId, sinceKeyVersion, knownEventIds = [] } = payload;

    const group = await this.groupRepo.getGroupById(groupId);
    if (!group) return;

    let isMember = group.members.some((m) => m.pubkey.value === requesterPubkey);

    // If requester is not in group.members yet, check for a valid pending JOIN_REQUEST (Kind 1504)
    if (!isMember && sinceKeyVersion !== undefined) {
      const validKey = await db.group_keys
        .where('[groupId+keyVersion]')
        .equals([groupId, sinceKeyVersion])
        .first();

      if (validKey) {
        const pendingJoinEvent = await db.events
          .where('groupId')
          .equals(groupId)
          .filter((e) => e.kind === 1504 && e.pubkey === requesterPubkey)
          .first();

        if (pendingJoinEvent) {
          try {
            const rawEvent = JSON.parse(pendingJoinEvent.rawEvent);
            const payloadObj =
              typeof rawEvent.content === 'string' && rawEvent.content.startsWith('{')
                ? JSON.parse(rawEvent.content)
                : rawEvent.content;

            const fulfillUseCase = new FulfillJoinRequestUseCase(this.groupRepo);
            const added = await fulfillUseCase.execute({
              groupId,
              joiningPubkey: requesterPubkey,
              joiningMember: payloadObj.joiningMember,
              invitationKeyVersion: sinceKeyVersion,
            });

            if (added) {
              const updatedGroup = await this.groupRepo.getGroupById(groupId);
              isMember =
                updatedGroup?.members.some((m) => m.pubkey.value === requesterPubkey) ?? false;
            }
          } catch {
            // Join fulfillment failed
          }
        }
      }
    }

    if (!isMember) {
      console.log(
        `SYNC recovery request rejected: ${requesterPubkey} is not a member of group ${groupId}`
      );
      return;
    }

    const currentIdentity = await identityService.getCurrentIdentity();
    if (!currentIdentity?.secretKey) return;

    // Re-send existing group key envelopes (sinceKeyVersion + 1 ... latest)
    const keys = await this.getAllGroupKeys(groupId);
    const startVersion = (sinceKeyVersion ?? 0) + 1;
    const neededKeys = keys.filter((k) => k.keyVersion >= startVersion);

    for (const keyRecord of neededKeys) {
      const envelope: GroupKeyEnvelope = {
        protocolVersion: 1,
        groupId,
        keyVersion: keyRecord.keyVersion,
        groupKey: keyRecord.groupKeyHex,
        issuedAt: keyRecord.createdAt,
      };

      try {
        const giftWrap = nip59GiftWrapService.createGiftWrap(
          envelope,
          currentIdentity.secretKey,
          requesterPubkey
        );
        await this.enqueueSignedEvent(giftWrap, groupId, requesterPubkey);
      } catch {
        // Continue fulfilling request
      }
    }

    // Re-send historical group events missing from requester's knownEventIds
    const knownSet = new Set<string>(knownEventIds);
    const storedEvents = await db.events.where('groupId').equals(groupId).toArray();

    for (const record of storedEvents) {
      if (!knownSet.has(record.id)) {
        try {
          const rawNostrEvent = JSON.parse(record.rawEvent) as NostrEvent;
          await this.enqueueSignedEvent(rawNostrEvent, groupId, requesterPubkey);
        } catch {
          // Continue fulfilling request
        }
      }
    }
  }

  private async drainOrphanBuffer(): Promise<void> {
    const readyOrphans = await orphanBuffer.drainReadyOrphans(async (pId) => {
      const exists = await db.events.get(pId);
      return !!exists;
    });

    for (const ready of readyOrphans) {
      console.log(`SYNC draining ready orphan event: ${ready.event.id}`);
      await this.persistAndReduceValidatedEvent(ready);
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

  /**
   * SOLE AUTHORITY for creating new group key epochs (Option B+ Architecture).
   * Generates a fresh AES key for keyVersion (currentMax + 1), persists to IndexedDB,
   * and dispatches NIP-59 Gift Wrap key envelopes to all active member pubkeys.
   */
  async rotateGroupKey(groupId: string, recipientPubkeys: string[]): Promise<GroupKeyRecord> {
    const currentKeys = await this.getAllGroupKeys(groupId);
    const nextKeyVersion =
      currentKeys.length > 0 ? Math.max(...currentKeys.map((k) => k.keyVersion)) + 1 : 1;

    const newGroupKeyHex = aesGcmCryptoService.generateGroupKeyHex();
    const now = Date.now();

    const newKeyRecord: GroupKeyRecord = {
      groupId,
      keyVersion: nextKeyVersion,
      groupKeyHex: newGroupKeyHex,
      createdAt: now,
    };

    await db.group_keys.add(newKeyRecord);

    const currentIdentity = await identityService.getCurrentIdentity();
    if (currentIdentity?.secretKey && recipientPubkeys.length > 0) {
      const envelope: GroupKeyEnvelope = {
        protocolVersion: 1,
        groupId,
        keyVersion: nextKeyVersion,
        groupKey: newGroupKeyHex,
        issuedAt: now,
      };

      for (const pubkey of recipientPubkeys) {
        try {
          const giftWrapEvent = nip59GiftWrapService.createGiftWrap(
            envelope,
            currentIdentity.secretKey,
            pubkey
          );
          await this.enqueueSignedEvent(giftWrapEvent, groupId, pubkey);
        } catch {
          // Continue delivering key envelope to remaining active members
        }
      }
    }

    return newKeyRecord;
  }

  async getGroupKey(groupId: string, keyVersion: number): Promise<GroupKeyRecord | undefined> {
    return db.group_keys.where('[groupId+keyVersion]').equals([groupId, keyVersion]).first();
  }

  async getLatestGroupKey(groupId: string): Promise<GroupKeyRecord | undefined> {
    const keys = await this.getAllGroupKeys(groupId);
    return keys.length > 0 ? keys[keys.length - 1] : undefined;
  }

  async getAllGroupKeys(groupId: string): Promise<GroupKeyRecord[]> {
    const keys = await db.group_keys.where('groupId').equals(groupId).toArray();
    return keys.sort((a, b) => a.keyVersion - b.keyVersion);
  }
}

export const syncCoordinator = new SyncCoordinator();
