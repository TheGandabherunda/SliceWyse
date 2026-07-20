import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ArrowRight } from 'lucide-react';
import { Avatar } from '../components/Avatar';
import { useAppContext } from '../AppContext';
import { CURRENCIES } from '../services/group';

export const SettleUp: React.FC = () => {
  const navigate = useNavigate();
  const { joinedGroups } = useAppContext();
  
  const [selectedGroup, setSelectedGroup] = useState(joinedGroups[0]?.address || '');
  const [amount, setAmount] = useState('');
  
  // Dummy data for now
  const fromUser = 'You';
  const toUser = 'Alice';

  const handleSettle = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount) return;
    console.log(`Settling ${amount} from ${fromUser} to ${toUser} in ${selectedGroup}`);
    navigate(-1);
  };

  const group = joinedGroups.find(g => g.address === selectedGroup);
  const currencySymbol = CURRENCIES.find(c => c.code === group?.currency)?.symbol || '$';

  return (
    <div className="animate-slide-up" style={{ paddingBottom: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2>Settle Up</h2>
        <button className="btn-icon" onClick={() => navigate(-1)}>
          <X size={24} />
        </button>
      </div>

      <div className="glass-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Avatar name={fromUser} size="lg" />
            <span style={{ marginTop: '0.5rem', fontWeight: 500 }}>{fromUser}</span>
          </div>
          
          <div style={{ color: 'var(--text-secondary)' }}>
            <ArrowRight size={32} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Avatar name={toUser} size="lg" />
            <span style={{ marginTop: '0.5rem', fontWeight: 500 }}>{toUser}</span>
          </div>
        </div>

        <form onSubmit={handleSettle} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Group</label>
            <select 
              value={selectedGroup} 
              onChange={e => setSelectedGroup(e.target.value)} 
              style={{ width: '100%' }}
              required
            >
              <option value="" disabled>Select a group</option>
              {joinedGroups.map(g => (
                <option key={g.address} value={g.address}>{g.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)', textAlign: 'center' }}>Amount</label>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--border-radius-md)', padding: '0 1rem', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
              <span style={{ fontSize: '2rem', color: 'var(--accent-positive)', marginRight: '0.5rem' }}>{currencySymbol}</span>
              <input 
                type="number" 
                step="0.01"
                value={amount} 
                onChange={e => setAmount(e.target.value)} 
                placeholder="0.00"
                style={{ width: '150px', background: 'transparent', border: 'none', padding: '1rem 0', fontSize: '2rem', color: 'var(--accent-positive)', textAlign: 'center' }}
                autoFocus
              />
            </div>
          </div>

          <button type="submit" className="btn-primary" style={{ marginTop: '1rem', background: 'var(--accent-positive)', boxShadow: '0 4px 14px var(--accent-positive-glow)' }}>
            Record Payment
          </button>
        </form>
      </div>
    </div>
  );
};
