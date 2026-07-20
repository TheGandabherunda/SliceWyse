import { createHelia } from 'helia';
import { createOrbitDB } from '@orbitdb/core';

let heliaInstance: any = null;
let orbitdbInstance: any = null;

export const initDB = async () => {
  if (orbitdbInstance) return orbitdbInstance;

  try {
    console.log('Initializing Helia (IPFS)...');
    heliaInstance = await createHelia();
    console.log('Helia initialized.');

    console.log('Initializing OrbitDB...');
    orbitdbInstance = await createOrbitDB({
      ipfs: heliaInstance,
      directory: './slicewyse-orbitdb',
    });
    console.log('OrbitDB initialized.', orbitdbInstance.identity.id);

    return orbitdbInstance;
  } catch (error) {
    console.error('Failed to initialize OrbitDB:', error);
    throw error;
  }
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
