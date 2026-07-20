import React, { createContext, useContext, useEffect, useState } from 'react';
import { initDB } from './services/db';
import { generateEncryptionKey, exportKeyToURLSafeBase64, importKeyFromURLSafeBase64 } from './services/encryption';
import { GroupService } from './services/group';

export interface JoinedGroup {
  address: string;
  name: string;
  currency: string;
  keyBase64: string;
}

interface AppState {
  isInitialized: boolean;
  cryptoKey: CryptoKey | null;
  joinedGroups: JoinedGroup[];
  addGroup: (name: string, currency: string) => Promise<void>;
  joinGroup: (address: string, keyBase64: string) => Promise<void>;
  error: string | null;
}

const AppContext = createContext<AppState | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [cryptoKey, setCryptoKey] = useState<CryptoKey | null>(null);
  const [joinedGroups, setJoinedGroups] = useState<JoinedGroup[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initialize = async () => {
      try {
        await initDB();
        
        // Load or generate master crypto key for the device (used for creating new groups)
        let storedKeyBase64 = localStorage.getItem('slicewyse_master_key');
        let key: CryptoKey;
        if (storedKeyBase64) {
          key = await importKeyFromURLSafeBase64(storedKeyBase64);
        } else {
          key = await generateEncryptionKey();
          storedKeyBase64 = await exportKeyToURLSafeBase64(key);
          localStorage.setItem('slicewyse_master_key', storedKeyBase64);
        }
        setCryptoKey(key);

        // Load joined groups from local storage
        const storedGroups = localStorage.getItem('slicewyse_groups');
        if (storedGroups) {
          setJoinedGroups(JSON.parse(storedGroups));
        }

        setIsInitialized(true);
      } catch (err: any) {
        setError(err.message || 'Failed to initialize database');
      }
    };

    initialize();
  }, []);

  const addGroup = async (name: string, currency: string) => {
    if (!cryptoKey) throw new Error('Not initialized');
    
    // Create a new key for this specific group so it can be shared safely
    const groupKey = await generateEncryptionKey();
    const groupKeyBase64 = await exportKeyToURLSafeBase64(groupKey);

    const service = await GroupService.createGroup(name, currency, groupKey);
    const newGroup: JoinedGroup = {
      address: service.address,
      name,
      currency,
      keyBase64: groupKeyBase64,
    };
    
    const updated = [...joinedGroups, newGroup];
    setJoinedGroups(updated);
    localStorage.setItem('slicewyse_groups', JSON.stringify(updated));
  };

  const joinGroup = async (address: string, keyBase64: string) => {
    const key = await importKeyFromURLSafeBase64(keyBase64);
    const service = await GroupService.joinGroup(address, key);
    
    // We need to fetch the initial config event to get the name and currency
    const events = await service.getAllEvents();
    const creationEvent = events.find(e => e.type === 'GROUP_CREATED');
    
    if (!creationEvent) {
      throw new Error('Invalid group or missing creation event');
    }

    const newGroup: JoinedGroup = {
      address,
      name: creationEvent.payload.name,
      currency: creationEvent.payload.currency,
      keyBase64,
    };

    const updated = [...joinedGroups, newGroup];
    setJoinedGroups(updated);
    localStorage.setItem('slicewyse_groups', JSON.stringify(updated));
  };

  return (
    <AppContext.Provider value={{ isInitialized, cryptoKey, joinedGroups, addGroup, joinGroup, error }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useAppContext must be used within AppProvider');
  return context;
};
