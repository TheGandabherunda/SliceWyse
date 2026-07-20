import React from 'react';
import { HashRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { BottomNav } from './components/BottomNav';
import { FAB } from './components/FAB';

import { Groups } from './pages/Groups';
import { AddExpense } from './pages/AddExpense';
import { SettleUp } from './pages/SettleUp';

// Placeholder Pages
const Dashboard = () => (
  <div className="animate-slide-up">
    <h2>Dashboard</h2>
    <div className="glass-card" style={{ marginTop: '1rem' }}>
      <p className="text-secondary">Total Balance</p>
      <h1 className="text-positive">+$140.50</h1>
      <div style={{ marginTop: '1rem' }}>
        <Link to="/settle" className="btn-primary" style={{ textDecoration: 'none', display: 'inline-block', background: 'var(--accent-positive)' }}>
          Settle Up
        </Link>
      </div>
    </div>
  </div>
);

const Friends = () => <div className="animate-slide-up"><h2>Friends</h2></div>;
const Activity = () => <div className="animate-slide-up"><h2>Activity</h2></div>;

const App: React.FC = () => {
  return (
    <Router>
      <div className="app-container">
        <header style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 style={{ color: 'var(--brand-primary)' }}>SliceWyse</h1>
        </header>

        <main>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/friends" element={<Friends />} />
            <Route path="/groups" element={<Groups />} />
            <Route path="/activity" element={<Activity />} />
            <Route path="/add-expense" element={<AddExpense />} />
            <Route path="/settle" element={<SettleUp />} />
          </Routes>
        </main>

        <FAB />
        <BottomNav />
      </div>
    </Router>
  );
};

export default App;
