import { Group } from '../../domain/entities/Group';
import { Member } from '../../domain/entities/Member';
import { Pubkey } from '../../domain/value-objects/Pubkey';
import { identityService } from '../../infrastructure/identity/IdentityService';
import { DexieGroupRepository } from '../../infrastructure/repositories/DexieGroupRepository';
import { syncCoordinator } from '../services/SyncCoordinator';
import { aesGcmCryptoService } from '../../infrastructure/crypto/AesGcmCryptoService';
import { db } from '../../infrastructure/db/SliceWyseDatabase';

export interface AcceptInviteLinkInput {
  groupId: string;
  invKeyHex: string;
  encryptedEventContent?: string;
  rawInvitationPayload?: any; // For direct offline acceptance or test fixtures
}

export class AcceptInviteLinkUseCase {
  constructor(private groupRepo = new DexieGroupRepository()) {}

  async execute(input: AcceptInviteLinkInput): Promise<Group> {
    const currentIdentity = await identityService.getCurrentIdentity();
    if (!currentIdentity) {
      throw new Error('User identity required to accept invitation');
    }

    let payload: any = input.rawInvitationPayload;

    if (!payload && input.encryptedEventContent) {
      try {
        let textToDecrypt = input.encryptedEventContent;
        if (textToDecrypt.trim().startsWith('{')) {
          const parsedContainer = JSON.parse(textToDecrypt);
          if (parsedContainer.encryptedPayload) {
            textToDecrypt = parsedContainer.encryptedPayload;
          }
        }

        const decryptedJson = await aesGcmCryptoService.decrypt(textToDecrypt, input.invKeyHex);
        payload = JSON.parse(decryptedJson);
      } catch {
        throw new Error('Failed to decrypt invitation envelope: Invalid invitation key');
      }
    }

    if (!payload || !payload.groupId || !payload.groupKeyHex || payload.keyVersion === undefined) {
      throw new Error('Invalid invitation payload structure');
    }

    if (payload.groupId !== input.groupId) {
      throw new Error(`Group ID mismatch: expected "${input.groupId}", got "${payload.groupId}"`);
    }

    if (payload.expiresAt && Date.now() > payload.expiresAt) {
      throw new Error('Invitation link has expired');
    }

    // 1. Store recovered group key under declared keyVersion
    const existingKey = await db.group_keys
      .where('[groupId+keyVersion]')
      .equals([payload.groupId, payload.keyVersion])
      .first();

    if (!existingKey) {
      await db.group_keys.add({
        groupId: payload.groupId,
        keyVersion: payload.keyVersion,
        groupKeyHex: payload.groupKeyHex,
        createdAt: payload.createdAt ?? Date.now(),
      });
    }

    // 2. Hydrate local Group entity
    const existingGroup = await this.groupRepo.getGroupById(payload.groupId);
    let group: Group;

    const newMember = new Member({
      pubkey: new Pubkey(currentIdentity.pubkey),
      displayName: currentIdentity.displayName,
      joinedAt: Date.now(),
    });

    if (existingGroup) {
      if (existingGroup.hasMember(currentIdentity.pubkey)) {
        return existingGroup;
      }
      group = new Group({
        id: existingGroup.id,
        name: existingGroup.name,
        currency: existingGroup.currency,
        members: [...existingGroup.members, newMember],
        createdAt: existingGroup.createdAt,
        updatedAt: Date.now(),
      });
    } else {
      group = new Group({
        id: payload.groupId,
        name: payload.groupName || 'Joined Group',
        currency: payload.currency || 'USD',
        members: [newMember],
        createdAt: payload.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      });
    }

    await this.groupRepo.saveGroup(group);

    // 3. Request historical sync catch-up (Kind 1505) from group members for any newer epochs / missing events
    await syncCoordinator.requestHistoricalSync(
      group.id,
      group.members.map((m) => m.pubkey.value),
      payload.keyVersion
    );

    return group;
  }
}
