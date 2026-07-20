import { createHeliaLight } from 'helia';
import { createOrbitDB } from '@orbitdb/core';
import type { Helia } from 'helia';

let heliaInstance: Helia | null = null;
let orbitdbInstance: any = null;
let initPromise: Promise<any> | null = null;

export const initDB = async () => {
  if (orbitdbInstance) return orbitdbInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      console.log('Initializing Helia (IPFS)...');
      
      const { createLibp2p } = await import('libp2p');
      const { identify } = await import('@libp2p/identify');
      const { gossipsub } = await import('@chainsafe/libp2p-gossipsub');
      const { webSockets } = await import('@libp2p/websockets');
      const { webRTC } = await import('@libp2p/webrtc');
      const { noise } = await import('@chainsafe/libp2p-noise');
      const { yamux } = await import('@chainsafe/libp2p-yamux');
      const { bootstrap } = await import('@libp2p/bootstrap');
      const { circuitRelayTransport } = await import('@libp2p/circuit-relay-v2');
      
      const libp2p = await createLibp2p({
        addresses: {
          listen: [
            '/webrtc'
          ]
        },
        transports: [
          webSockets(),
          webRTC(),
          circuitRelayTransport({ discoverRelays: 1 } as any)
        ],
        connectionEncrypters: [noise()],
        streamMuxers: [yamux()],
        peerDiscovery: [
          bootstrap({
            list: [
              '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
              '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb'
            ]
          })
        ],
        services: {
          identify: identify(),
          pubsub: gossipsub({ allowPublishToZeroTopicPeers: true }) as any
        }
      });

      const { IDBBlockstore } = await import('blockstore-idb');
      const { IDBDatastore } = await import('datastore-idb');
      
      const blockstore = new IDBBlockstore('helia-blocks');
      const datastore = new IDBDatastore('helia-data');
      await blockstore.open();
      await datastore.open();

      const { withLibp2p } = await import('@helia/libp2p');
      const dagCbor = await import('@ipld/dag-cbor');
      const dagJson = await import('@ipld/dag-json');
      const json = await import('multiformats/codecs/json');
      const { sha512 } = await import('multiformats/hashes/sha2');

      const baseHelia = createHeliaLight({ 
        blockstore,
        datastore,
        codecs: [dagCbor, dagJson, json],
        hashers: [sha512]
      });
      
      heliaInstance = await withLibp2p(baseHelia, libp2p);
      await heliaInstance.start();
      console.log('Helia initialized with GossipSub.');

      console.log('Initializing OrbitDB...');
      orbitdbInstance = await createOrbitDB({
        ipfs: heliaInstance,
        directory: './slicewyse-orbitdb',
      });
      console.log('OrbitDB initialized.', orbitdbInstance.identity.id);

      return orbitdbInstance;
    } catch (error) {
      console.error('Failed to initialize OrbitDB:', error);
      initPromise = null;
      throw error;
    }
  })();

  return initPromise;
};

export const getOrbitDB = () => orbitdbInstance;
export const getHelia = () => heliaInstance;

// Helper to get local user info
export const getLocalUser = () => {
  const stored = localStorage.getItem('slicewyse_user');
  if (stored) {
    return JSON.parse(stored);
  }
  
  // Create a default user if not exists
  const newUser = {
    id: crypto.randomUUID(),
    name: 'Anonymous',
    createdAt: Date.now()
  };
  localStorage.setItem('slicewyse_user', JSON.stringify(newUser));
  return newUser;
};

export const updateLocalUser = (name: string) => {
  const user = getLocalUser();
  user.name = name;
  localStorage.setItem('slicewyse_user', JSON.stringify(user));
  return user;
};
