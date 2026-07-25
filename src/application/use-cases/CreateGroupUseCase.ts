import { Group } from '../../domain/entities/Group';
import { Member } from '../../domain/entities/Member';
import { Pubkey } from '../../domain/value-objects/Pubkey';
import { identityService } from '../../infrastructure/identity/IdentityService';
import { DexieGroupRepository } from '../../infrastructure/repositories/DexieGroupRepository';
import { syncCoordinator } from '../services/SyncCoordinator';
import { aesGcmCryptoService } from '../../infrastructure/crypto/AesGcmCryptoService';
import {
  nip59GiftWrapService,
  type GroupKeyEnvelope,
} from '../../infrastructure/crypto/Nip59GiftWrapService';
import { db } from '../../infrastructure/db/SliceWyseDatabase';

export interface CreateGroupInput {
  name: string;
  currency: string;
  memberNames?: string[];
}

export class CreateGroupUseCase {
  constructor(private groupRepo = new DexieGroupRepository()) {}

  async execute(input: CreateGroupInput): Promise<Group> {
    if (!input.name || input.name.trim().length === 0) {
      throw new Error('Group name is required');
    }

    const currentIdentity = await identityService.getCurrentIdentity();
    if (!currentIdentity) {
      throw new Error('User identity required to create group');
    }

    const creatorMember = new Member({
      pubkey: new Pubkey(currentIdentity.pubkey),
      displayName: currentIdentity.displayName,
      joinedAt: Date.now(),
    });

    const members: Member[] = [creatorMember];

    if (input.memberNames && input.memberNames.length > 0) {
      for (const name of input.memberNames) {
        if (name.trim().length > 0) {
          const dummySecret =
            crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
          const dummyPubkey = dummySecret.slice(0, 64);
          members.push(
            new Member({
              pubkey: new Pubkey(dummyPubkey),
              displayName: name.trim(),
              joinedAt: Date.now(),
            })
          );
        }
      }
    }

    const groupId = `grp_${crypto.randomUUID().slice(0, 8)}`;
    const group = new Group({
      id: groupId,
      name: input.name.trim(),
      currency: input.currency || 'USD',
      members,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await this.groupRepo.saveGroup(group);

    // 1. Generate 32-byte Group Key (keyVersion = 1)
    const groupKeyHex = aesGcmCryptoService.generateGroupKeyHex();
    await db.group_keys.add({
      groupId: group.id,
      keyVersion: 1,
      groupKeyHex,
      createdAt: Date.now(),
    });

    // 2. Distribute NIP-59 key envelopes to members and self-recovery context
    if (currentIdentity.secretKey) {
      const envelope: GroupKeyEnvelope = {
        protocolVersion: 1,
        groupId: group.id,
        keyVersion: 1,
        groupKey: groupKeyHex,
        issuedAt: Date.now(),
      };

      for (const member of group.members) {
        try {
          const giftWrapEvent = await nip59GiftWrapService.createGiftWrap(
            envelope,
            currentIdentity.secretKey,
            member.pubkey.value
          );
          await syncCoordinator.enqueueEvent(group.id, 1059, giftWrapEvent, [member.pubkey.value]);
        } catch {
          // Ignore key envelope send errors for offline/dummy members
        }
      }
    }

    // 3. Enqueue Immutable Group Creation Event (Kind 1500)
    const groupPayload = {
      type: 'GROUP_CREATED',
      groupId: group.id,
      name: group.name,
      currency: group.currency,
      members: group.members.map((m) => ({
        pubkey: m.pubkey.value,
        displayName: m.displayName,
        joinedAt: m.joinedAt,
      })),
      keyVersion: 1,
      parentEventIds: [],
      createdAt: group.createdAt,
    };

    await syncCoordinator.enqueueEvent(
      group.id,
      1500,
      groupPayload,
      group.members.map((m) => m.pubkey.value)
    );

    return group;
  }
}
