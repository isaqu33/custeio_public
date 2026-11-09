import { render, screen } from '@testing-library/react';
import { NavUser } from '@/components/nav-user';

jest.mock('@/hooks/use-user-session', () => ({
  useUserSession: () => ({
    session: { name: 'loyanne', email: 'loyanerk@hotmail.com', urlString: undefined, _id: 'u1' },
    refetch: jest.fn(),
  }),
}));

// Account, theme, density and sign out moved to the header's gear menu
// (AccountMenuButton) — this row is now just "who is signed in", nothing to
// click, so it must not carry a dropdown trigger of its own.
describe('NavUser', () => {
  it('shows the signed-in name and email', () => {
    render(<NavUser />);

    expect(screen.getByText('loyanne')).toBeInTheDocument();
    expect(screen.getByText('loyanerk@hotmail.com')).toBeInTheDocument();
  });

  it('is not a button and opens no menu', () => {
    render(<NavUser />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
