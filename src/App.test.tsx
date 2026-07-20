import './setupTests';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import App from './App';


// Mock the DB service
vi.mock('./services/db', () => ({
  initDB: vi.fn().mockResolvedValue({}),
  getLocalUser: vi.fn().mockReturnValue({ id: 'test-user', name: 'Tester' }),
  getOrbitDB: vi.fn().mockReturnValue({}),
  getHelia: vi.fn().mockReturnValue({}),
}));

// Mock the group service
vi.mock('./services/group', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    getGroups: vi.fn().mockReturnValue([]),
  };
});

describe('App Initialization', () => {
  it('renders loading state initially and then transitions to dashboard', async () => {
    render(<App />);
    
    // Initially should show loading
    expect(screen.getByText('Connecting to P2P Network...')).toBeInTheDocument();
    
    // After initDB resolves, it should show the dashboard
    await waitFor(() => {
      expect(screen.queryByText('Connecting to P2P Network...')).not.toBeInTheDocument();
    });
    
    // The dashboard header should be visible
    expect(screen.getByText('SliceWyse')).toBeInTheDocument();
    expect(screen.getByText('Total Balance')).toBeInTheDocument();
  });
});
