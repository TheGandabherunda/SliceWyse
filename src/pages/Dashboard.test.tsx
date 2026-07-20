import '../setupTests';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { Dashboard } from './Dashboard';
import * as AppContextModule from '../AppContext';

vi.mock('../AppContext', () => ({
  useAppContext: vi.fn()
}));

const renderWithContext = (contextValue: any) => {
  vi.mocked(AppContextModule.useAppContext).mockReturnValue(contextValue);
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  );
};

describe('Dashboard Component', () => {
  it('displays aggregated balances by currency', () => {
    // Mock user and groups with expenses
    const mockUser = { id: 'u1', name: 'Me' };
    
    // Group 1: USD (Me paid 100, split with u2) -> Me: +50
    const group1 = {
      address: 'g1',
      name: 'G1',
      currency: 'USD',
      expenses: [
        { id: 'e1', description: 'Food', amount: 100, paidBy: 'u1', timestamp: 1, splits: { 'u1': 50, 'u2': 50 } }
      ]
    };

    // Group 2: USD (u3 paid 60, split with u1, u3) -> Me: -30
    const group2 = {
      address: 'g2',
      name: 'G2',
      currency: 'USD',
      expenses: [
        { id: 'e2', description: 'Taxi', amount: 60, paidBy: 'u3', timestamp: 2, splits: { 'u1': 30, 'u3': 30 } }
      ]
    };

    // Group 3: EUR (Me paid 40, split with u4) -> Me: +20
    const group3 = {
      address: 'g3',
      name: 'G3',
      currency: 'EUR',
      expenses: [
        { id: 'e3', description: 'Train', amount: 40, paidBy: 'u1', timestamp: 3, splits: { 'u1': 20, 'u4': 20 } }
      ]
    };

    renderWithContext({
      joinedGroups: [group1, group2, group3],
      localUser: mockUser,
      cryptoKey: 'mock-key', // trigger calculation
    });

    // Total USD Balance: 50 - 30 = 20
    // Total EUR Balance: 20

    expect(screen.getAllByText('USD').length).toBeGreaterThan(0);
    expect(screen.getAllByText('EUR').length).toBeGreaterThan(0);
    
    // Check if +20 is rendered for both currencies
    // The amount is formatted as "$20.00" or "€20.00" depending on how currency formatting is implemented
    expect(screen.getByText('+$20.00')).toBeInTheDocument();
    expect(screen.getByText('+€20.00')).toBeInTheDocument();
  });
});
