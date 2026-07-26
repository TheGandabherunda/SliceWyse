import { z } from 'zod';

export const GroupCreatedPayloadSchema = z.object({
  type: z.literal('GROUP_CREATED'),
  groupId: z.string().min(1),
  name: z.string().min(1),
  currency: z.string().min(1),
  members: z.array(
    z.object({
      pubkey: z.string().min(1),
      displayName: z.string().min(1),
      joinedAt: z.number(),
    })
  ),
  keyVersion: z.number().int().positive().default(1),
  parentEventIds: z.array(z.string()).default([]),
  createdAt: z.number(),
});

export const GroupUpdatedPayloadSchema = z.object({
  type: z.literal('GROUP_UPDATED'),
  groupId: z.string().min(1),
  name: z.string().min(1).optional(),
  currency: z.string().min(1).optional(),
  keyVersion: z.number().int().positive().optional(),
  parentEventIds: z.array(z.string()).default([]),
  updatedAt: z.number(),
});

export const MembershipAddedPayloadSchema = z.object({
  type: z.literal('MEMBERSHIP_ADDED'),
  groupId: z.string().min(1),
  member: z.object({
    pubkey: z.string().min(1),
    displayName: z.string().min(1),
    joinedAt: z.number(),
  }),
  keyVersion: z.number().int().positive().optional(),
  parentEventIds: z.array(z.string()).default([]),
});

export const MembershipRemovedPayloadSchema = z.object({
  type: z.literal('MEMBERSHIP_REMOVED'),
  groupId: z.string().min(1),
  removedPubkey: z.string().min(1),
  keyVersion: z.number().int().positive().optional(),
  parentEventIds: z.array(z.string()).default([]),
});

export const ExpenseCreatedPayloadSchema = z.object({
  type: z.literal('EXPENSE_CREATED').optional(),
  id: z.string().min(1),
  groupId: z.string().min(1),
  title: z.string().min(1),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().min(1),
  paidBy: z.array(
    z.object({
      pubkey: z.string().min(1),
      amountCents: z.number().int().nonnegative(),
    })
  ),
  splits: z.array(
    z.object({
      pubkey: z.string().min(1),
      amountCents: z.number().int().nonnegative(),
    })
  ),
  splitType: z.enum(['EQUAL', 'EXACT', 'PERCENTAGE']),
  date: z.number(),
  revision: z.number().int().positive().default(1),
  parentEventIds: z.array(z.string()).default([]),
  isDeleted: z.boolean().default(false),
  createdBy: z.string().min(1),
});

export const ExpenseUpdatedPayloadSchema = z.object({
  type: z.literal('EXPENSE_UPDATED'),
  id: z.string().min(1),
  groupId: z.string().min(1),
  title: z.string().min(1).optional(),
  amountCents: z.number().int().nonnegative().optional(),
  currency: z.string().min(1).optional(),
  paidBy: z
    .array(
      z.object({
        pubkey: z.string().min(1),
        amountCents: z.number().int().nonnegative(),
      })
    )
    .optional(),
  splits: z
    .array(
      z.object({
        pubkey: z.string().min(1),
        amountCents: z.number().int().nonnegative(),
      })
    )
    .optional(),
  splitType: z.enum(['EQUAL', 'EXACT', 'PERCENTAGE']).optional(),
  revision: z.number().int().positive(),
  parentEventIds: z.array(z.string()).default([]),
  isDeleted: z.boolean().optional(),
});

export const ExpenseDeletedPayloadSchema = z.object({
  type: z.literal('EXPENSE_DELETED'),
  id: z.string().min(1),
  groupId: z.string().min(1),
  parentEventIds: z.array(z.string()).default([]),
  isDeleted: z.literal(true),
});

export const SettlementCreatedPayloadSchema = z.object({
  type: z.literal('SETTLEMENT_CREATED').optional(),
  id: z.string().min(1),
  groupId: z.string().min(1),
  payer: z.string().min(1),
  payee: z.string().min(1),
  amountCents: z.number().int().positive(),
  currency: z.string().min(1),
  date: z.number(),
  parentEventIds: z.array(z.string()).default([]),
  createdBy: z.string().min(1),
});

export const SettlementDeletedPayloadSchema = z.object({
  type: z.literal('SETTLEMENT_DELETED'),
  id: z.string().min(1),
  groupId: z.string().min(1),
  parentEventIds: z.array(z.string()).default([]),
  isDeleted: z.literal(true),
});

export const GroupKeyEnvelopeSchema = z.object({
  protocolVersion: z.number().int().positive().default(1),
  groupId: z.string().min(1),
  keyVersion: z.number().int().positive(),
  groupKey: z.string().length(64),
  issuedAt: z.number(),
});

// Union Validators for Kind 1500, 1501, 1502, 1059
export const Kind1500PayloadSchema = z.union([
  GroupCreatedPayloadSchema,
  GroupUpdatedPayloadSchema,
  MembershipAddedPayloadSchema,
  MembershipRemovedPayloadSchema,
]);

export const SyncRequestPayloadSchema = z.object({
  type: z.literal('SYNC_REQUEST'),
  groupId: z.string().min(1),
  sinceKeyVersion: z.number().int().optional(),
  knownEventIds: z.array(z.string()).default([]),
  requestedAt: z.number(),
});

export const Kind1501PayloadSchema = z.union([
  ExpenseDeletedPayloadSchema,
  ExpenseUpdatedPayloadSchema,
  ExpenseCreatedPayloadSchema,
]);

export const Kind1502PayloadSchema = z.union([
  SettlementDeletedPayloadSchema,
  SettlementCreatedPayloadSchema,
]);

export const JoinRequestPayloadSchema = z.object({
  type: z.literal('JOIN_REQUEST'),
  groupId: z.string().min(1),
  joiningMember: z.object({
    pubkey: z.string().min(1),
    displayName: z.string().min(1),
    joinedAt: z.number(),
  }),
  invitationKeyVersion: z.number().int().positive(),
  requestedAt: z.number(),
});

export const GroupInvitationPayloadSchema = z.object({
  type: z.literal('GROUP_INVITATION'),
  groupId: z.string().min(1),
  groupName: z.string().min(1),
  currency: z.string().min(1).default('USD'),
  inviterPubkey: z.string().min(1),
  groupKeyHex: z.string().length(64),
  keyVersion: z.number().int().positive(),
  expiresAt: z.number().optional(),
  createdAt: z.number(),
});

export type GroupCreatedPayload = z.infer<typeof GroupCreatedPayloadSchema>;
export type GroupUpdatedPayload = z.infer<typeof GroupUpdatedPayloadSchema>;
export type MembershipAddedPayload = z.infer<typeof MembershipAddedPayloadSchema>;
export type MembershipRemovedPayload = z.infer<typeof MembershipRemovedPayloadSchema>;
export type ExpenseCreatedPayload = z.infer<typeof ExpenseCreatedPayloadSchema>;
export type ExpenseUpdatedPayload = z.infer<typeof ExpenseUpdatedPayloadSchema>;
export type ExpenseDeletedPayload = z.infer<typeof ExpenseDeletedPayloadSchema>;
export type SettlementCreatedPayload = z.infer<typeof SettlementCreatedPayloadSchema>;
export type SettlementDeletedPayload = z.infer<typeof SettlementDeletedPayloadSchema>;
export type GroupKeyEnvelopePayload = z.infer<typeof GroupKeyEnvelopeSchema>;
export type SyncRequestPayload = z.infer<typeof SyncRequestPayloadSchema>;
export type GroupInvitationPayload = z.infer<typeof GroupInvitationPayloadSchema>;
export type JoinRequestPayload = z.infer<typeof JoinRequestPayloadSchema>;

/**
 * Validates raw decrypted JSON payload against the expected Nostr event schema.
 * Throws a descriptive Error if validation fails.
 */
export function parseAndValidateEventPayload(kind: number, rawPayload: unknown): any {
  if (!rawPayload || typeof rawPayload !== 'object') {
    throw new Error(`Invalid event payload: expected object for kind ${kind}`);
  }

  if (kind === 1059) {
    return GroupKeyEnvelopeSchema.parse(rawPayload);
  }

  if (kind === 1500) {
    return Kind1500PayloadSchema.parse(rawPayload);
  }

  if (kind === 1501) {
    return Kind1501PayloadSchema.parse(rawPayload);
  }

  if (kind === 1502) {
    return Kind1502PayloadSchema.parse(rawPayload);
  }

  if (kind === 1504) {
    return JoinRequestPayloadSchema.parse(rawPayload);
  }

  if (kind === 1505) {
    return SyncRequestPayloadSchema.parse(rawPayload);
  }

  if (kind === 30078) {
    return GroupInvitationPayloadSchema.parse(rawPayload);
  }

  throw new Error(`Unsupported application event kind ${kind} for schema validation`);
}
