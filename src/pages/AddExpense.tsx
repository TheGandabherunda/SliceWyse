import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { useAppContext } from '../AppContext';
import { CURRENCIES } from '../services/group';

export const AddExpense: React.FC = () => {
  const navigate = useNavigate();
  const { joinedGroups } = useAppContext();
  
  const [selectedGroup, setSelectedGroup] = useState(joinedGroups[0]?.address || '');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [splitMethod, setSplitMethod] = useState<'EQUAL' | 'EXACT' | 'PERCENTAGE'>('EQUAL');

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!description || !amount) return;

    console.log('Saving expense:', { description, amount, splitMethod });
    // TODO: Wire up to OrbitDB event log
    navigate(-1);
  };

  const group = joinedGroups.find(g => g.address === selectedGroup);
  const currencySymbol = CURRENCIES.find(c => c.code === group?.currency)?.symbol || '$';

  return (
    <div className="animate-slide-up" style={{ paddingBottom: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2>Add Expense</h2>
        <button className="btn-icon" onClick={() => navigate(-1)}>
          <X size={24} />
        </button>
      </div>

      <div className="glass-card">
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
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
            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Description</label>
            <input 
              type="text" 
              value={description} 
              onChange={e => setDescription(e.target.value)} 
              placeholder="Dinner at Luigi's"
              style={{ width: '100%' }}
              autoFocus
            />
          </div>
          
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Amount</label>
            <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--border-radius-md)', padding: '0 1rem', border: '1px solid rgba(255,255,255,0.1)' }}>
              <span style={{ fontSize: '1.25rem', color: 'var(--text-secondary)', marginRight: '0.5rem' }}>{currencySymbol}</span>
              <input 
                type="number" 
                step="0.01"
                value={amount} 
                onChange={e => setAmount(e.target.value)} 
                placeholder="0.00"
                style={{ width: '100%', background: 'transparent', border: 'none', padding: '0.75rem 0', fontSize: '1.25rem' }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Split Method</label>
            <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(255,255,255,0.05)', padding: '0.5rem', borderRadius: 'var(--border-radius-md)' }}>
              {(['EQUAL', 'EXACT', 'PERCENTAGE'] as const).map(method => (
                <button
                  key={method}
                  type="button"
                  onClick={() => setSplitMethod(method)}
                  style={{
                    flex: 1,
                    padding: '0.5rem',
                    borderRadius: 'var(--border-radius-sm)',
                    background: splitMethod === method ? 'var(--brand-primary)' : 'transparent',
                    color: splitMethod === method ? 'white' : 'var(--text-secondary)',
                    fontWeight: 500,
                  }}
                >
                  {method === 'EQUAL' ? '=' : method === 'EXACT' ? '1.23' : '%'}
                </button>
              ))}
            </div>
          </div>

          {/* Placeholder for dynamic split inputs based on selected method */}
          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: 'var(--border-radius-md)' }}>
            <p className="text-secondary text-center" style={{ fontSize: '0.875rem' }}>
              {splitMethod === 'EQUAL' && 'Split equally among all group members.'}
              {splitMethod === 'EXACT' && 'Specify exactly how much each person owes.'}
              {splitMethod === 'PERCENTAGE' && 'Specify what percentage of the total each person owes.'}
            </p>
          </div>

          <button type="submit" className="btn-primary" style={{ marginTop: '1rem' }}>
            Save Expense
          </button>
        </form>
      </div>
    </div>
  );
};
