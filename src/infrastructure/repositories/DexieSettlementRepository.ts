import { db, type SettlementRecord } from '../db/SliceWyseDatabase';
import { Settlement } from '../../domain/entities/Settlement';
import { Money } from '../../domain/value-objects/Money';

export class DexieSettlementRepository {
  async saveSettlement(settlement: Settlement): Promise<void> {
    const record: SettlementRecord = {
      id: settlement.id,
      groupId: settlement.groupId,
      payer: settlement.payer,
      payee: settlement.payee,
      amountCents: settlement.amount.amountCents,
      currency: settlement.amount.currency,
      date: settlement.date,
      parentEventIdsJson: JSON.stringify([]),
      createdBy: settlement.createdBy,
      syncStatus: 'QUEUED',
    };

    await db.settlements.put(record);
  }

  async getSettlementsByGroupId(groupId: string): Promise<Settlement[]> {
    const records = await db.settlements.where({ groupId }).toArray();

    return records.map(
      (record) =>
        new Settlement({
          id: record.id,
          groupId: record.groupId,
          payer: record.payer,
          payee: record.payee,
          amount: new Money(record.amountCents, record.currency),
          date: record.date,
          createdBy: record.createdBy,
        })
    );
  }

  async getSettlementById(id: string): Promise<Settlement | null> {
    const record = await db.settlements.get(id);
    if (!record) return null;

    return new Settlement({
      id: record.id,
      groupId: record.groupId,
      payer: record.payer,
      payee: record.payee,
      amount: new Money(record.amountCents, record.currency),
      date: record.date,
      createdBy: record.createdBy,
    });
  }
}
