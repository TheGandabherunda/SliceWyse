import '../setupTests';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GroupService } from './group';
import * as dbModule from './db';
import { generateEncryptionKey } from './encryption';

vi.mock('./db', () => ({
  getOrbitDB: vi.fn(),
  getLocalUser: vi.fn().mockReturnValue({ id: 'user-123', name: 'Test User' }),
}));

describe('GroupService', () => {
  let mockOrbitDB: any;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      address: { toString: () => 'orbitdb/test-address-123' },
      add: vi.fn().mockResolvedValue('hash123'),
      iterator: vi.fn().mockReturnValue({
        collect: vi.fn().mockResolvedValue([]),
      }),
    };

    mockOrbitDB = {
      open: vi.fn().mockResolvedValue(mockDb),
    };

    vi.mocked(dbModule.getOrbitDB).mockReturnValue(mockOrbitDB);
  });

  it('creates a group using IPFSAccessController without throwing error', async () => {
    const key = await generateEncryptionKey();
    const service = await GroupService.createGroup('Trip to Paris', 'EUR', key);

    expect(mockOrbitDB.open).toHaveBeenCalledWith(
      expect.stringMatching(/^slicewyse-group-/),
      expect.objectContaining({
        type: 'events',
        AccessController: expect.any(Function),
      })
    );

    expect(mockDb.add).toHaveBeenCalled();
    expect(service.address).toBe('orbitdb/test-address-123');
  });
});
