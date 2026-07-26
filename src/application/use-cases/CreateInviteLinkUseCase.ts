import { identityService } from '../../infrastructure/identity/IdentityService';
import { DexieGroupRepository } from '../../infrastructure/repositories/DexieGroupRepository';
import { syncCoordinator } from '../services/SyncCoordinator';
import { aesGcmCryptoService } from '../../infrastructure/crypto/AesGcmCryptoService';

export interface CreateInviteLinkInput {
  groupId: string;
  expiresAt?: number;
  relayUrl?: string;
}

export interface CreateInviteLinkResult {
  inviteUrl: string;
  invKeyHex: string;
  eventId: string;
}

export class CreateInviteLinkUseCase {
  constructor(private groupRepo = new DexieGroupRepository()) {}

  async execute(input: CreateInviteLinkInput): Promise<CreateInviteLinkResult> {
    const group = await this.groupRepo.getGroupById(input.groupId);
    if (!group) {
      throw new Error(`Group with ID "${input.groupId}" not found`);
    }

    const currentIdentity = await identityService.getCurrentIdentity();
    if (!currentIdentity) {
      throw new Error('User identity required to create invitation');
    }

    // Get current group key
    const latestKey = await syncCoordinator.getLatestGroupKey(group.id);
    if (!latestKey) {
      throw new Error(`No active group key found for group "${group.id}"`);
    }

    // Generate 256-bit ephemeral invitation bearer key (K_inv)
    const invKeyHex = aesGcmCryptoService.generateGroupKeyHex();

    const invitationPayload = {
      type: 'GROUP_INVITATION',
      groupId: group.id,
      groupName: group.name,
      currency: group.currency,
      inviterPubkey: currentIdentity.pubkey,
      groupKeyHex: latestKey.groupKeyHex,
      keyVersion: latestKey.keyVersion,
      createdAt: Date.now(),
    };

    // Encrypt payload using ephemeral K_inv (groupKeyHex is NEVER exposed in URL)
    const encryptedPayload = await aesGcmCryptoService.encrypt(
      JSON.stringify(invitationPayload),
      invKeyHex
    );

    const eventId = `evt_${crypto.randomUUID()}`;

    // Publish Kind 30078 invitation event as an immutable snapshot
    await syncCoordinator.enqueueEvent(group.id, 30078, {
      ...invitationPayload,
      encryptedPayload,
    });

    const relayQuery = input.relayUrl ? `&relay=${encodeURIComponent(input.relayUrl)}` : '';
    const inviteUrl = `#/join?groupId=${encodeURIComponent(group.id)}&invKey=${invKeyHex}${relayQuery}`;

    return {
      inviteUrl,
      invKeyHex,
      eventId,
    };
  }
}
