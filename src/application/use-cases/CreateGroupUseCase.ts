import { Group } from '../../domain/entities/Group';
import { Member } from '../../domain/entities/Member';
import { Pubkey } from '../../domain/value-objects/Pubkey';
import { identityService } from '../../infrastructure/identity/IdentityService';
import { DexieGroupRepository } from '../../infrastructure/repositories/DexieGroupRepository';
import { syncCoordinator } from '../services/SyncCoordinator';

export interface CreateGroupInput {
  name: string;
  currency?: string;
}

export class CreateGroupUseCase {
  constructor(private groupRepo = new DexieGroupRepository()) {}

  async execute(input: CreateGroupInput): Promise<Group> {
    const currentIdentity = await identityService.getCurrentIdentity();
    if (!currentIdentity) {
      throw new Error('User identity is required to create a group');
    }

    const groupId = `grp_${crypto.randomUUID().slice(0, 8)}`;
    const now = Date.now();

    const creatorMember = new Member({
      pubkey: new Pubkey(currentIdentity.pubkey),
      displayName: currentIdentity.displayName,
      joinedAt: now,
    });

    const group = new Group({
      id: groupId,
      name: input.name,
      currency: input.currency || 'USD',
      members: [creatorMember],
      createdAt: now,
      updatedAt: now,
    });

    await this.groupRepo.saveGroup(group);

    // Enqueue encrypted group creation event for Nostr relay sync
    const groupPayload = {
      groupId: group.id,
      name: group.name,
      currency: group.currency,
      members: group.members.map((m) => ({
        pubkey: m.pubkey.value,
        displayName: m.displayName,
        joinedAt: m.joinedAt,
      })),
      createdAt: group.createdAt,
    };

    await syncCoordinator.enqueueEvent(
      group.id,
      30078,
      JSON.stringify(groupPayload),
      group.members.map((m) => m.pubkey.value)
    );

    return group;
  }
}
