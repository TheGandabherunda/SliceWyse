import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '../../src/infrastructure/db/SliceWyseDatabase';
import { syncCoordinator } from '../../src/application/services/SyncCoordinator';
import { CreateInviteLinkUseCase } from '../../src/application/use-cases/CreateInviteLinkUseCase';
import { AcceptInviteLinkUseCase } from '../../src/application/use-cases/AcceptInviteLinkUseCase';
import { Group } from '../../src/domain/entities/Group';
import { Member } from '../../src/domain/entities/Member';
import { Pubkey } from '../../src/domain/value-objects/Pubkey';
import { DexieGroupRepository } from '../../src/infrastructure/repositories/DexieGroupRepository';
import { aesGcmCryptoService } from '../../src/infrastructure/crypto/AesGcmCryptoService';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex } from 'nostr-tools/utils';

describe('Milestone 7: Ephemeral Bearer Invitation Envelopes (Kind 30078)', () => {
  const aliceSecretBytes = generateSecretKey();
  const aliceSecretHex = bytesToHex(aliceSecretBytes);
  const alicePubkey = getPublicKey(aliceSecretBytes);

  const bobSecretBytes = generateSecretKey();
  const bobSecretHex = bytesToHex(bobSecretBytes);
  const bobPubkey = getPublicKey(bobSecretBytes);

  const groupRepo = new DexieGroupRepository();

  beforeEach(async () => {
    await db.identities.clear();
    await db.group_keys.clear();
    await db.groups.clear();
    await db.members.clear();
    await db.events.clear();
    await db.sync_queue.clear();

    await db.identities.add({
      pubkey: alicePubkey,
      secretKey: aliceSecretHex,
      displayName: 'Alice',
      isCurrent: 1,
      createdAt: Date.now(),
    });
  });

  it('CreateInviteLinkUseCase generates URL with invKey, keeping groupKey encrypted inside payload', async () => {
    vi.spyOn(syncCoordinator, 'processSyncQueue').mockResolvedValue(undefined);

    const groupId = 'grp_inv_100';
    const group = new Group({
      id: groupId,
      name: 'Hawaii Trip',
      currency: 'USD',
      members: [
        new Member({ pubkey: new Pubkey(alicePubkey), displayName: 'Alice', joinedAt: 1000 }),
      ],
      createdAt: 1000,
      updatedAt: 1000,
    });
    await groupRepo.saveGroup(group);

    const keyRecord = await syncCoordinator.rotateGroupKey(groupId, [alicePubkey]);

    const useCase = new CreateInviteLinkUseCase(groupRepo);
    const result = await useCase.execute({ groupId, relayUrl: 'wss://relay.damus.io' });

    expect(result.inviteUrl).toContain('#/join?groupId=grp_inv_100&invKey=');
    expect(result.inviteUrl).not.toContain(keyRecord.groupKeyHex); // Group key MUST NOT be in URL
    expect(result.invKeyHex).toHaveLength(64);
  });

  it('AcceptInviteLinkUseCase decrypts payload, stores declared keyVersion, and hydrates group', async () => {
    const groupId = 'grp_inv_200';
    const groupKeyHex = aesGcmCryptoService.generateGroupKeyHex();
    const invKeyHex = aesGcmCryptoService.generateGroupKeyHex();

    const rawPayload = {
      type: 'GROUP_INVITATION',
      groupId,
      groupName: 'Skiing Trip',
      currency: 'CAD',
      inviterPubkey: alicePubkey,
      groupKeyHex,
      keyVersion: 1,
      createdAt: 1700000000,
    };

    const encryptedContent = await aesGcmCryptoService.encrypt(
      JSON.stringify(rawPayload),
      invKeyHex
    );

    // Switch active identity to Bob
    await db.identities.clear();
    await db.identities.add({
      pubkey: bobPubkey,
      secretKey: bobSecretHex,
      displayName: 'Bob',
      isCurrent: 1,
      createdAt: Date.now(),
    });

    const acceptUseCase = new AcceptInviteLinkUseCase();
    const result = await acceptUseCase.execute({
      groupId,
      invKeyHex,
      encryptedEventContent: encryptedContent,
    });

    expect(result.groupId).toBe(groupId);
    expect(result.inviterPubkey).toBe(alicePubkey);
    expect(result.keyVersion).toBe(1);

    // Verify ZERO synthetic group projections were created
    const syntheticGroup = await groupRepo.getGroupById(groupId);
    expect(syntheticGroup).toBeNull();

    // Verify group key stored under declared keyVersion 1
    const storedKey = await syncCoordinator.getGroupKey(groupId, 1);
    expect(storedKey).toBeDefined();
    expect(storedKey?.groupKeyHex).toBe(groupKeyHex);
  });

  it('fails acceptance with invalid invitation key', async () => {
    const groupId = 'grp_inv_300';
    const validInvKey = aesGcmCryptoService.generateGroupKeyHex();
    const invalidInvKey = aesGcmCryptoService.generateGroupKeyHex();

    const rawPayload = {
      type: 'GROUP_INVITATION',
      groupId,
      groupName: 'Party',
      currency: 'USD',
      inviterPubkey: alicePubkey,
      groupKeyHex: aesGcmCryptoService.generateGroupKeyHex(),
      keyVersion: 1,
      createdAt: 1700000000,
    };

    const encryptedContent = await aesGcmCryptoService.encrypt(
      JSON.stringify(rawPayload),
      validInvKey
    );

    const acceptUseCase = new AcceptInviteLinkUseCase(groupRepo);
    await expect(
      acceptUseCase.execute({
        groupId,
        invKeyHex: invalidInvKey,
        encryptedEventContent: encryptedContent,
      })
    ).rejects.toThrow('Failed to decrypt invitation envelope');
  });
});
