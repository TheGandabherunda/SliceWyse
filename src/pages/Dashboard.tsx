import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppContext } from '../AppContext';
import { CURRENCIES } from '../services/group';

export const Dashboard: React.FC = () => {
  const { joinedGroups, cryptoKey, localUser } = useAppContext();
  const [balancesByCurrency, setBalancesByCurrency] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const calculateBalances = async () => {
      if (!cryptoKey) return;
      setIsLoading(true);
      // In a real app we'd query OrbitDB per group. For this prototype/test, 
      // we assume the group object has an 'expenses' array loaded, or we default to 0.
      const balances: Record<string, number> = {};
      if (joinedGroups.length > 0) {
        for (const group of joinedGroups) {
          if (!balances[group.currency]) balances[group.currency] = 0;
          
          let groupBalance = 0;
          if (group.expenses) {
            for (const expense of group.expenses) {
              const myId = localUser?.id || 'unknown';
              const iPaid = expense.paidBy === myId ? expense.amount : 0;
              const iOwe = expense.splits?.[myId] || 0;
              groupBalance += (iPaid - iOwe);
            }
          }
          balances[group.currency] += groupBalance;
        }
      } else {
        balances['USD'] = 0;
      }

      setBalancesByCurrency(balances);
      setIsLoading(false);
    };

    calculateBalances();
  }, [joinedGroups, cryptoKey]);

  return (
    <div className="animate-slide-up">
      <h2>Dashboard</h2>
      <div className="glass-card" style={{ marginTop: '1rem' }}>
        <p className="text-secondary">Total Balance</p>
        {isLoading ? (
           <h1 className="text-secondary" style={{ opacity: 0.5 }}>...</h1>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {Object.entries(balancesByCurrency).map(([currencyCode, amount]) => {
              const symbol = CURRENCIES.find(c => c.code === currencyCode)?.symbol || currencyCode;
              return (
                <h1 key={currencyCode} className={amount >= 0 ? "text-positive" : "text-negative"}>
                  {amount >= 0 ? '+' : '-'}{symbol}{Math.abs(amount).toFixed(2)}
                </h1>
              );
            })}
          </div>
        )}
        <div style={{ marginTop: '1rem' }}>
          <Link to="/settle" className="btn-primary" style={{ textDecoration: 'none', display: 'inline-block', background: 'var(--accent-positive)' }}>
            Settle Up
          </Link>
        </div>
      </div>
      
      <div style={{ marginTop: '2rem' }}>
        <h3>Your Groups</h3>
        {joinedGroups.length === 0 ? (
          <p className="text-secondary" style={{ marginTop: '1rem' }}>You haven't joined any groups yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
            {joinedGroups.map(group => (
              <div key={group.address} className="glass" style={{ padding: '1rem', borderRadius: 'var(--border-radius-md)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 600 }}>{group.name}</span>
                  <span className="text-secondary">{group.currency}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
