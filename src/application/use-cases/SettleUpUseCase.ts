import { Settlement } from '../../domain/entities/Settlement';
import { Money } from '../../domain/value-objects/Money';
import { identityService } from '../../infrastructure/identity/IdentityService';
import { DexieSettlementRepository } from '../../infrastructure/repositories/DexieSettlementRepository';
import { DexieGroupRepository } from '../../infrastructure/repositories/DexieGroupRepository';
import { syncCoordinator } from '../services/SyncCoordinator';

export interface SettleUpInput {
  groupId: string;
  payerPubkey: string;
  payeePubkey: string;
  amountCents: number;
  currency: string;
}

export class SettleUpUseCase {
  constructor(
    private settlementRepo = new DexieSettlementRepository(),
    private groupRepo = new DexieGroupRepository()
  ) {}

  async execute(input: SettleUpInput): Promise<Settlement> {
    const currentIdentity = await identityService.getCurrentIdentity();
    if (!currentIdentity) {
      throw new Error('User identity required to record settlement');
    }

    const group = await this.groupRepo.getGroupById(input.groupId);
    if (!group) {
      throw new Error(`Group with ID "${input.groupId}" not found`);
    }

    const settlement = new Settlement({
      id: `set_${crypto.randomUUID().slice(0, 8)}`,
      groupId: input.groupId,
      payer: input.payerPubkey,
      payee: input.payeePubkey,
      amount: new Money(input.amountCents, input.currency),
      date: Date.now(),
      createdBy: currentIdentity.pubkey,
    });

    await this.settlementRepo.saveSettlement(settlement);

    // Enqueue encrypted settlement event for Nostr relay sync
    const settlementPayload = {
      v: 1,
      type: 'SETTLEMENT_CREATED',
      groupId: settlement.groupId,
      settlementId: settlement.id,
      payer: settlement.payer,
      payee: settlement.payee,
      amountCents: settlement.amount.amountCents,
      currency: settlement.amount.currency,
      date: settlement.date,
      createdBy: settlement.createdBy,
    };

    await syncCoordinator.enqueueEvent(
      settlement.groupId,
      30080,
      JSON.stringify(settlementPayload),
      group.members.map((member) => member.pubkey.value)
    );

    return settlement;
  }
}
