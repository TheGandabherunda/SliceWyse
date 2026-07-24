import { Settlement } from '../../domain/entities/Settlement';
import { Money } from '../../domain/value-objects/Money';
import { identityService } from '../../infrastructure/identity/IdentityService';
import { DexieSettlementRepository } from '../../infrastructure/repositories/DexieSettlementRepository';

export interface SettleUpInput {
  groupId: string;
  payerPubkey: string;
  payeePubkey: string;
  amountCents: number;
  currency: string;
}

export class SettleUpUseCase {
  constructor(private settlementRepo = new DexieSettlementRepository()) {}

  async execute(input: SettleUpInput): Promise<Settlement> {
    const currentIdentity = await identityService.getCurrentIdentity();
    if (!currentIdentity) {
      throw new Error('User identity required to record settlement');
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
    return settlement;
  }
}
