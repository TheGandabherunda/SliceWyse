import React from 'react';
import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import { BottomNav } from './components/BottomNav';
import { FAB } from './components/FAB';

import { Groups } from './pages/Groups';
import { AddExpense } from './pages/AddExpense';
import { SettleUp } from './pages/SettleUp';
import { Dashboard } from './pages/Dashboard';
import { AppProvider, useAppContext } from './AppContext';

// Loading Shell
const AppShell = () => {
  const { isInitialized, error } = useAppContext();

  if (error) {
    return (
      <div className="app-container text-center" style={{ marginTop: '4rem' }}>
        <h2 className="text-negative">Initialization Error</h2>
        <p className="text-secondary">{error}</p>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="app-container text-center" style={{ marginTop: '4rem' }}>
        <h2 className="text-secondary">Connecting to P2P Network...</h2>
        <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'center' }}>
          {/* Simple skeleton loader */}
          <div style={{ width: '40px', height: '40px', borderRadius: '50%', border: '4px solid var(--bg-elevated)', borderTopColor: 'var(--brand-primary)', animation: 'spin 1s linear infinite' }} />
        </div>
        <style>{`
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        `}</style>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ color: 'var(--brand-primary)' }}>SliceWyse</h1>
      </header>

      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/groups" element={<Groups />} />
          <Route path="/add-expense" element={<AddExpense />} />
          <Route path="/settle" element={<SettleUp />} />
        </Routes>
      </main>

      <FAB />
      <BottomNav />
    </div>
  );
};

const App: React.FC = () => {
  return (
    <AppProvider>
      <Router>
        <AppShell />
      </Router>
    </AppProvider>
  );
};

export default App;
