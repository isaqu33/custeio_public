import { render, screen } from '@testing-library/react';
import { LayoutDashboard } from 'lucide-react';
import { NavMain } from '@/components/nav-main';

let pathname = '/organization/dashboard';

jest.mock('next/navigation', () => ({
  usePathname: () => pathname,
}));

// Nav entries are real Links now. Outside an app-router context the real ones have
// nothing to report, so they are stubbed down to what this test cares about: an
// anchor carrying the label. `useLinkStatus` stays real (via next/link's mock
// below) so `LinkLoadingHint` itself renders unmocked.
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  useLinkStatus: () => ({ pending: false }),
}));

jest.mock('@/components/ui/sidebar', () => ({
  SidebarGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarGroupLabel: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
  SidebarGroupContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarMenu: ({ children }: { children: React.ReactNode }) => <ul>{children}</ul>,
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => <li>{children}</li>,
  // The real button renders through Slot when `asChild` is set, so this wrapper
  // just carries the `isActive` state through to a `data-active` attribute and
  // passes the Link through untouched.
  SidebarMenuButton: ({
    children,
    isActive,
  }: {
    children: React.ReactNode;
    isActive?: boolean;
  }) => (
    <div data-testid="menu-button" data-active={isActive ? 'true' : 'false'}>
      {children}
    </div>
  ),
}));

// Localized labels — the active highlight must not depend on them. One flat
// list per group, matching how NavMain actually renders now: no accordion, no
// sub-menu component, every page a direct entry.
const ITEMS = [
  {
    title: 'Usuário',
    url: '/organization',
    icon: LayoutDashboard,
    items: [{ title: 'Painel', url: '/organization/dashboard' }],
  },
  {
    title: 'Sistema',
    url: '/system',
    items: [
      { title: 'Jobs', url: '/system/jobs' },
      { title: 'Marca', url: '/system/branding' },
      { title: 'Organizações', url: '/system/organization' },
    ],
  },
];

function activeLabels() {
  return screen
    .getAllByTestId('menu-button')
    .filter((wrapper) => wrapper.getAttribute('data-active') === 'true')
    .map((wrapper) => wrapper.textContent);
}

describe('NavMain active item', () => {
  it('highlights the entry matching the current path, regardless of language', () => {
    pathname = '/organization/dashboard';
    render(<NavMain items={ITEMS} />);
    expect(activeLabels()).toEqual(['Painel']);
  });

  it('keeps an entry highlighted on its own sub-page', () => {
    pathname = '/system/organization/some-org-id';
    render(<NavMain items={ITEMS} />);
    expect(activeLabels()).toEqual(['Organizações']);
  });

  // `organization` appears as a URL segment in both the tenant workspace root
  // and the System organizations list. Matching each entry's own full URL
  // (not just a shared segment) is what keeps them from lighting up together.
  it('does not light up the tenant dashboard for the organizations list under System', () => {
    pathname = '/system/organization';
    render(<NavMain items={ITEMS} />);
    expect(activeLabels()).toEqual(['Organizações']);
  });

  it('highlights nothing when the path matches no entry', () => {
    pathname = '/unknown-section';
    render(<NavMain items={ITEMS} />);
    expect(activeLabels()).toEqual([]);
  });

  // The dash is the "you are here" marker. Only the entry that owns the open
  // screen lights it — a prefix match (the sub-page test above) must not.
  it('lights the dash only on the entry that owns the open screen exactly', () => {
    pathname = '/system/organization/some-org-id';
    render(<NavMain items={ITEMS} />);

    const lit = screen
      .getAllByRole('link')
      .filter((link) =>
        Array.from(link.querySelectorAll('span[aria-hidden="true"]')).some((hint) =>
          hint.className.includes('opacity-100'),
        ),
      )
      .map((link) => link.textContent);

    expect(lit).toEqual([]);
  });
});
