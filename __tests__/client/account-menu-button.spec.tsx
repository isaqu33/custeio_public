import { render, screen } from '@testing-library/react';
import { AccountMenuButton } from '@/components/account-menu-button';

jest.mock('@/app/lib/i18n/client', () => ({
  useCopy: () => jest.requireActual('@/app/lib/i18n/dictionary').DICTIONARIES['pt-BR'],
}));
jest.mock('@/hooks/use-user-session', () => ({
  useUserSession: () => ({
    session: { name: 'loyanne', email: 'loyanerk@hotmail.com', urlString: undefined, _id: 'u1' },
    refetch: jest.fn(),
  }),
}));
jest.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'dark', setTheme: jest.fn() }),
}));
jest.mock('@/components/ui-density', () => ({
  useUiDensity: () => ({ isCompact: false, toggleDensity: jest.fn() }),
}));
jest.mock('next-auth/react', () => ({ signOut: jest.fn() }));
jest.mock('@/components/edit-profile-modal', () => ({
  EditProfileModal: () => <div>Conta</div>,
}));

// Account, theme, density and sign out used to live behind the sidebar
// footer's name+email button; this is the header's gear that replaces it.
// The menu's open state is Radix's own (untested at this level elsewhere in
// the codebase, e.g. the store/organization scope popovers) — this checks
// the trigger itself mounts correctly, labeled and independent of any
// sidebar context.
describe('AccountMenuButton', () => {
  it('renders a labeled gear button, not tied to a sidebar', () => {
    render(<AccountMenuButton />);

    const trigger = screen.getByRole('button', { name: /conta/i });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
