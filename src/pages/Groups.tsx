import React, { useState } from 'react';
import { CURRENCIES } from '../services/group';

export const Groups: React.FC = () => {
  const [isCreating, setIsCreating] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [currency, setCurrency] = useState('USD');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName) return;
    
    console.log('Creating group:', groupName, currency);
    // TODO: Wire up GroupService and navigation to the new group
    setIsCreating(false);
    setGroupName('');
  };

  return (
    <div className="animate-slide-up">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2>Groups</h2>
        <button className="btn-primary" onClick={() => setIsCreating(true)} style={{ padding: '0.5rem 1rem' }}>
          New Group
        </button>
      </div>

      {isCreating && (
        <div className="glass-card" style={{ marginBottom: '1rem' }}>
          <h3>Create a Group</h3>
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Group Name</label>
              <input 
                type="text" 
                value={groupName} 
                onChange={e => setGroupName(e.target.value)} 
                placeholder="Trip to Paris..."
                style={{ width: '100%' }}
                autoFocus
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Currency</label>
              <select value={currency} onChange={e => setCurrency(e.target.value)} style={{ width: '100%' }}>
                {CURRENCIES.map(c => (
                  <option key={c.code} value={c.code}>
                    {c.symbol} - {c.name} ({c.code})
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setIsCreating(false)} style={{ background: 'transparent', color: 'var(--text-secondary)' }}>Cancel</button>
              <button type="submit" className="btn-primary">Create</button>
            </div>
          </form>
        </div>
      )}

      <div className="glass-card">
        <p className="text-secondary text-center">You are not part of any groups yet.</p>
      </div>
    </div>
  );
};
