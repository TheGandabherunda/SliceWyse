import '../setupTests';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Groups } from './Groups';
import * as AppContextModule from '../AppContext';

vi.mock('../AppContext', () => ({
  useAppContext: vi.fn()
}));

const renderWithContext = (contextValue: any) => {
  vi.mocked(AppContextModule.useAppContext).mockReturnValue(contextValue);
  return render(<Groups />);
};

describe('Groups Component', () => {
  it('allows creating a new group', async () => {
    const addGroupMock = vi.fn().mockResolvedValue(undefined);
    
    renderWithContext({
      addGroup: addGroupMock,
      joinedGroups: [],
    });

    // Click "New Group" button
    const createBtn = screen.getByText('New Group');
    fireEvent.click(createBtn);

    // Fill out form
    const nameInput = screen.getByPlaceholderText('Trip to Paris...');
    fireEvent.change(nameInput, { target: { value: 'My Test Group' } });
    
    // Check if currency select exists (defaults to USD $)
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'EUR' } });

    // Submit
    const submitBtn = screen.getByText('Create');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(addGroupMock).toHaveBeenCalledWith('My Test Group', 'EUR');
    });
  });

  it('displays joined groups', () => {
    renderWithContext({
      addGroup: vi.fn(),
      joinedGroups: [
        { id: '1', name: 'Test Group 1', currency: 'USD' },
      ],
    });

    expect(screen.getByText('Test Group 1')).toBeInTheDocument();
  });
});
