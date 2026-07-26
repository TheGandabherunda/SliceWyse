import { Settlement } from '../../domain/entities/Settlement';
import { Money } from '../../domain/value-objects/Money';
import { identityService } from '../../infrastructure/identity/IdentityService';
import { DexieSettlementRepository } from '../../infrastructure/repositories/DexieSettlementRepository';
import { syncCoordinator } from '../services/SyncCoordinator';

export interface SettleUpInput {
  groupId: string;
  payerPubkey: string;
  payeePubkey: string;
  amountCents: number;
  currency: string;
  parentEventIds?: string[];
}

export class SettleUpUseCase {
  constructor(private settlementRepo = new DexieSettlementRepository()) {}

  async execute(input: SettleUpInput): Promise<Settlement> {
    const currentIdentity = await identityService.getCurrentIdentity();
    if (!currentIdentity) {
      throw new Error('User identity required to record settlement');
    }

    const settlementId = `set_${crypto.randomUUID().slice(0, 8)}`;
    const now = Date.now();

    // Construct Immutable Settlement Event (Kind 1502)
    const settlementPayload = {
      type: 'SETTLEMENT_CREATED',
      id: settlementId,
      settlementId,
      groupId: input.groupId,
      payer: input.payerPubkey,
      payee: input.payeePubkey,
      amountCents: input.amountCents,
      currency: input.currency,
      date: now,
      keyVersion: 1,
      parentEventIds: input.parentEventIds ?? [],
      createdBy: currentIdentity.pubkey,
    };

    // Submit Local Event via Unified Pipeline (ADR-005)
    // Validates -> Signs -> db.events -> EventReducer.reduceSettlement() -> db.settlements -> db.sync_queue
    await syncCoordinator.submitLocalEvent({
      groupId: input.groupId,
      eventKind: 1502,
      unencryptedPayload: settlementPayload,
      parentEventIds: input.parentEventIds ?? [],
      recipientPubkeys: [input.payerPubkey, input.payeePubkey],
    });

    // Return canonical Settlement projection populated by EventReducer
    const createdSettlement = await this.settlementRepo.getSettlementById(settlementId);
    if (!createdSettlement) {
      throw new Error(`Failed to initialize settlement projection for ${settlementId}`);
    }

    return createdSettlement;
  }
}
