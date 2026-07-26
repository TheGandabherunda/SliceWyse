import { describe, expect, it } from 'vitest';
import {
  parseAndValidateEventPayload,
  GroupCreatedPayloadSchema,
  ExpenseCreatedPayloadSchema,
  GroupKeyEnvelopeSchema,
  SettlementCreatedPayloadSchema,
} from '../../src/domain/events/EventSchemas';

describe('Milestone 1: Event Model & Schema Validation Engine', () => {
  describe('GroupCreatedPayloadSchema (Kind 1500)', () => {
    it('validates a correct GROUP_CREATED payload', () => {
      const validPayload = {
        type: 'GROUP_CREATED',
        groupId: 'grp_123',
        name: 'Road Trip',
        currency: 'USD',
        members: [
          {
            pubkey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
            displayName: 'Alice',
            joinedAt: 1700000000,
          },
        ],
        keyVersion: 1,
        parentEventIds: [],
        createdAt: 1700000000,
      };

      const parsed = parseAndValidateEventPayload(1500, validPayload);
      expect(parsed).toEqual(validPayload);
    });

    it('rejects GROUP_CREATED payload with missing required name', () => {
      const invalidPayload = {
        type: 'GROUP_CREATED',
        groupId: 'grp_123',
        currency: 'USD',
        members: [],
        createdAt: 1700000000,
      };

      expect(() => parseAndValidateEventPayload(1500, invalidPayload)).toThrow();
    });
  });

  describe('ExpenseCreatedPayloadSchema (Kind 1501)', () => {
    it('validates a correct EXPENSE_CREATED payload', () => {
      const validPayload = {
        type: 'EXPENSE_CREATED',
        id: 'exp_001',
        groupId: 'grp_123',
        title: 'Gas',
        amountCents: 4500,
        currency: 'USD',
        paidBy: [{ pubkey: 'pubkey_alice', amountCents: 4500 }],
        splits: [{ pubkey: 'pubkey_alice', amountCents: 4500 }],
        splitType: 'EQUAL',
        date: 1700000100,
        revision: 1,
        parentEventIds: ['evt_group_created'],
        isDeleted: false,
        createdBy: 'pubkey_alice',
      };

      const parsed = parseAndValidateEventPayload(1501, validPayload);
      expect(parsed.id).toBe('exp_001');
      expect(parsed.amountCents).toBe(4500);
    });

    it('rejects EXPENSE_CREATED payload with negative amountCents', () => {
      const invalidPayload = {
        type: 'EXPENSE_CREATED',
        id: 'exp_001',
        groupId: 'grp_123',
        title: 'Gas',
        amountCents: -500,
        currency: 'USD',
        paidBy: [],
        splits: [],
        splitType: 'EQUAL',
        date: 1700000100,
        createdBy: 'pubkey_alice',
      };

      expect(() => parseAndValidateEventPayload(1501, invalidPayload)).toThrow();
    });
  });

  describe('SettlementCreatedPayloadSchema (Kind 1502)', () => {
    it('validates a correct SETTLEMENT_CREATED payload', () => {
      const validPayload = {
        type: 'SETTLEMENT_CREATED',
        id: 'set_001',
        groupId: 'grp_123',
        payer: 'pubkey_bob',
        payee: 'pubkey_alice',
        amountCents: 2000,
        currency: 'USD',
        date: 1700000200,
        parentEventIds: [],
        createdBy: 'pubkey_bob',
      };

      const parsed = parseAndValidateEventPayload(1502, validPayload);
      expect(parsed.amountCents).toBe(2000);
    });
  });

  describe('GroupKeyEnvelopeSchema (Kind 1059)', () => {
    it('validates a correct NIP-59 inner GroupKeyEnvelope payload', () => {
      const validEnvelope = {
        protocolVersion: 1,
        groupId: 'grp_123',
        keyVersion: 1,
        groupKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        issuedAt: 1700000000,
      };

      const parsed = parseAndValidateEventPayload(1059, validEnvelope);
      expect(parsed.groupKey).toHaveLength(64);
    });

    it('rejects GroupKeyEnvelope with invalid groupKey length', () => {
      const invalidEnvelope = {
        protocolVersion: 1,
        groupId: 'grp_123',
        keyVersion: 1,
        groupKey: 'short_key',
        issuedAt: 1700000000,
      };

      expect(() => parseAndValidateEventPayload(1059, invalidEnvelope)).toThrow();
    });
  });

  describe('Unsupported kind validation', () => {
    it('throws error for unsupported application event kind', () => {
      expect(() => parseAndValidateEventPayload(9999, {})).toThrow(
        /Unsupported application event kind 9999/
      );
    });
  });
});
