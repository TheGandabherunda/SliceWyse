import { db, type GroupRecord, type MemberRecord } from '../db/SliceWyseDatabase';
import { Group } from '../../domain/entities/Group';
import { Member } from '../../domain/entities/Member';
import { Pubkey } from '../../domain/value-objects/Pubkey';
import { identityService } from '../identity/IdentityService';

export class DexieGroupRepository {
  async saveGroup(group: Group): Promise<void> {
    const groupRecord: GroupRecord = {
      id: group.id,
      name: group.name,
      currency: group.currency,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    };

    await db.transaction('rw', db.groups, db.members, async () => {
      await db.groups.put(groupRecord);

      // Save members
      for (const member of group.members) {
        const existing = await db.members
          .where('[groupId+pubkey]')
          .equals([group.id, member.pubkey.value])
          .first();

        if (!existing) {
          const memberRecord: MemberRecord = {
            groupId: group.id,
            pubkey: member.pubkey.value,
            displayName: member.displayName,
            joinedAt: member.joinedAt,
          };
          await db.members.add(memberRecord);
        }
      }
    });
  }

  async getGroupById(groupId: string): Promise<Group | null> {
    const groupRecord = await db.groups.get(groupId);
    if (!groupRecord) return null;

    const currentIdentity = await identityService.getCurrentIdentity();
    const memberRecords = await db.members.where({ groupId }).toArray();

    const members = memberRecords.map((m) => {
      let displayName = m.displayName;
      if (
        currentIdentity &&
        m.pubkey.toLowerCase() === currentIdentity.pubkey.toLowerCase() &&
        currentIdentity.displayName &&
        currentIdentity.displayName !== 'Nostr User' &&
        currentIdentity.displayName !== 'Nostr Extension User'
      ) {
        displayName = currentIdentity.displayName;
      }

      return new Member({
        pubkey: new Pubkey(m.pubkey),
        displayName,
        joinedAt: m.joinedAt,
      });
    });

    return new Group({
      id: groupRecord.id,
      name: groupRecord.name,
      currency: groupRecord.currency,
      members,
      createdAt: groupRecord.createdAt,
      updatedAt: groupRecord.updatedAt,
    });
  }

  async getAllGroups(): Promise<Group[]> {
    const groupRecords = await db.groups.orderBy('updatedAt').reverse().toArray();
    const groups: Group[] = [];

    for (const record of groupRecords) {
      const group = await this.getGroupById(record.id);
      if (group) groups.push(group);
    }
    return groups;
  }
}
