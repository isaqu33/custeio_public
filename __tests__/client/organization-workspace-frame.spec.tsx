import { render, screen } from '@testing-library/react';
import { OrganizationWorkspaceFrame } from '@/components/organization-workspace-frame';

jest.mock('@/app/lib/i18n/client', () => ({
  useCopy: () => jest.requireActual('@/app/lib/i18n/dictionary').DICTIONARIES['pt-BR'],
}));
jest.mock('next/navigation', () => ({ usePathname: () => mockPathname }));
jest.mock('@/components/organization-scope-selector', () => ({
  OrganizationScopeSelector: () => <div data-testid="scope-selector" />,
}));

let mockPathname = '/organization/stock';

// Only a System/Support session may pick which organization to look at (see
// docs/features/organizations.md) — a tenant session has exactly the
// organizations `Users.organizationIds` gives it, and "todas as organizações"
// only ever meant "everything this session can see", which reads as
// platform-wide to someone who should not be shown a scope concept at all.
describe('OrganizationWorkspaceFrame', () => {
  it('shows the scope bar on a workspace path for a System/Support session', () => {
    render(
      <OrganizationWorkspaceFrame hasSystemAccess>
        <div>conteúdo</div>
      </OrganizationWorkspaceFrame>,
    );

    expect(screen.getByTestId('scope-selector')).toBeInTheDocument();
  });

  it('never shows the scope bar for a tenant session, even on a workspace path', () => {
    render(
      <OrganizationWorkspaceFrame hasSystemAccess={false}>
        <div>conteúdo</div>
      </OrganizationWorkspaceFrame>,
    );

    expect(screen.queryByTestId('scope-selector')).not.toBeInTheDocument();
    expect(screen.getByText('conteúdo')).toBeInTheDocument();
  });

  it('does not show the bar outside the workspace paths, even for System', () => {
    mockPathname = '/system/organization';
    render(
      <OrganizationWorkspaceFrame hasSystemAccess>
        <div>conteúdo</div>
      </OrganizationWorkspaceFrame>,
    );

    expect(screen.queryByTestId('scope-selector')).not.toBeInTheDocument();
    mockPathname = '/organization/stock';
  });

  it.each([
    '/organization/dashboard',
    '/organization/stock',
    '/organization/products',
    '/system/jobs',
    '/system/audit-events',
  ])('renders the bar for System on every workspace path (%s)', (path) => {
    mockPathname = path;
    render(
      <OrganizationWorkspaceFrame hasSystemAccess>
        <div>conteúdo</div>
      </OrganizationWorkspaceFrame>,
    );

    expect(screen.getByTestId('scope-selector')).toBeInTheDocument();
    mockPathname = '/organization/stock';
  });
});
