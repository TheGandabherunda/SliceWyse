import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import './FAB.css';

export const FAB: React.FC = () => {
  const navigate = useNavigate();
  return (
    <button className="fab" onClick={() => navigate('/add-expense')} aria-label="Add Expense">
      <Plus size={28} />
    </button>
  );
};
