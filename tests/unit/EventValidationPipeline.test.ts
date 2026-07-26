import { describe, expect, it, vi } from 'vitest';
import { EventValidationPipeline } from '../../src/domain/events/../services/EventValidationPipeline';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { bytesToHex } from 'nostr-tools/utils';
import { aesGcmCryptoService } from '../../src/infrastructure/crypto/AesGcmCryptoService';

describe('Milestone 2: 8-Step Event Validation Pipeline', () => {
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);

  it('rejects malformed Nostr event objects (Step 1)', async () => {
    const invalidEvent: any = { kind: 1500, content: '{}' };
    const result = await EventValidationPipeline.validateAndDecryptEvent(
      invalidEvent,
      async () => []
    );

    expect(result.isValid).toBe(false);
    expect(result.error).toContain('Step 1 Failed');
  });

  it('rejects events with invalid Schnorr signatures (Step 2)', async () => {
    const validEvent = finalizeEvent(
      {
        kind: 1500,
        created_at: 1700000000,
        tags: [['d', 'grp_123']],
        content: JSON.stringify({
          type: 'GROUP_CREATED',
          groupId: 'grp_123',
          name: 'Trip',
          currency: 'USD',
          members: [],
          createdAt: 1700000000,
        }),
      },
      secretKey
    );

    // Create raw event object with invalid signature string (without cached verifiedSymbol)
    const corruptEvent: any = {
      id: validEvent.id,
      kind: validEvent.kind,
      pubkey: validEvent.pubkey,
      created_at: validEvent.created_at,
      tags: validEvent.tags,
      content: validEvent.content,
      sig: '00'.repeat(64),
    };

    const result = await EventValidationPipeline.validateAndDecryptEvent(
      corruptEvent,
      async () => []
    );
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('Step 2 Failed');
  });

  it('rejects unsupported event kinds (Step 3)', async () => {
    const event = finalizeEvent(
      {
        kind: 9999,
        created_at: 1700000000,
        tags: [],
        content: '{}',
      },
      secretKey
    );

    const result = await EventValidationPipeline.validateAndDecryptEvent(event, async () => []);
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('Step 3 Failed');
  });

  it('rejects events missing group ID tag (Step 4)', async () => {
    const event = finalizeEvent(
      {
        kind: 1500,
        created_at: 1700000000,
        tags: [], // missing ["d", "groupId"] tag
        content: JSON.stringify({
          type: 'GROUP_CREATED',
          groupId: 'grp_123',
          name: 'Trip',
          currency: 'USD',
          members: [],
          createdAt: 1700000000,
        }),
      },
      secretKey
    );

    const result = await EventValidationPipeline.validateAndDecryptEvent(event, async () => []);
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('Step 4 Failed');
  });

  it('rejects events that fail decryption when group keys exist (Step 5)', async () => {
    const event = finalizeEvent(
      {
        kind: 1500,
        created_at: 1700000000,
        tags: [['d', 'grp_123']],
        content: 'invalid_ciphertext_garbage',
      },
      secretKey
    );

    const mockKeys = [
      {
        groupId: 'grp_123',
        keyVersion: 1,
        groupKeyHex: aesGcmCryptoService.generateGroupKeyHex(),
        createdAt: 1700000000,
      },
    ];

    const result = await EventValidationPipeline.validateAndDecryptEvent(
      event,
      async () => mockKeys
    );
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('Step 5 Failed');
  });

  it('rejects decrypted payloads failing Zod schema validation (Step 7)', async () => {
    const groupKeyHex = aesGcmCryptoService.generateGroupKeyHex();
    const invalidPayload = JSON.stringify({
      type: 'GROUP_CREATED',
      groupId: 'grp_123',
      // missing name field required by GroupCreatedPayloadSchema
      currency: 'USD',
      members: [],
      createdAt: 1700000000,
    });

    const ciphertext = await aesGcmCryptoService.encrypt(invalidPayload, groupKeyHex);

    const event = finalizeEvent(
      {
        kind: 1500,
        created_at: 1700000000,
        tags: [['d', 'grp_123']],
        content: ciphertext,
      },
      secretKey
    );

    const mockKeys = [{ groupId: 'grp_123', keyVersion: 1, groupKeyHex, createdAt: 1700000000 }];

    const result = await EventValidationPipeline.validateAndDecryptEvent(
      event,
      async () => mockKeys
    );
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('Step 7 Failed');
  });

  it('successfully validates, decrypts, and parses valid encrypted event', async () => {
    const groupKeyHex = aesGcmCryptoService.generateGroupKeyHex();
    const validPayload = {
      type: 'GROUP_CREATED',
      groupId: 'grp_123',
      name: 'Summer Vacation',
      currency: 'EUR',
      members: [
        {
          pubkey: pubkey,
          displayName: 'Alice',
          joinedAt: 1700000000,
        },
      ],
      keyVersion: 1,
      parentEventIds: [],
      createdAt: 1700000000,
    };

    const ciphertext = await aesGcmCryptoService.encrypt(JSON.stringify(validPayload), groupKeyHex);

    const event = finalizeEvent(
      {
        kind: 1500,
        created_at: 1700000000,
        tags: [['d', 'grp_123']],
        content: ciphertext,
      },
      secretKey
    );

    const mockKeys = [{ groupId: 'grp_123', keyVersion: 1, groupKeyHex, createdAt: 1700000000 }];

    const result = await EventValidationPipeline.validateAndDecryptEvent(
      event,
      async () => mockKeys
    );
    expect(result.isValid).toBe(true);
    expect(result.groupId).toBe('grp_123');
    expect(result.payload.name).toBe('Summer Vacation');
  });
});
