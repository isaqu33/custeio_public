/**
 * @jest-environment node
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * Every protected page has to decide access on the server.
 *
 * Hiding a sidebar entry is a convenience — a typed URL, a bookmark or a stale
 * link all reach the page directly. This walks the real route tree instead of a
 * hand-kept list, so a page added tomorrow without a guard fails here rather
 * than shipping open.
 */
const PROTECTED_ROOT = path.join(process.cwd(), 'app', '(protected)');

/** Guard expected for each route. `null` = deliberately open to any session. */
const EXPECTED_GUARD: Record<string, 'system' | null> = {
  // No feature gates it — open to any authenticated, organization-scoped
  // session. See the comment on the page itself.
  'organization/dashboard': null,
  'organization/stock': null,
  'organization/invoices': null,
  'organization/preparations': null,
  'organization/prices': null,
  'organization/internal-use': null,
  'organization/products': null,
  'organization/modifiers': null,
  'organization/orders': null,
  'organization/sales': null,
  // Everything under System, including the grouping page itself.
  system: 'system',
  'system/audit-events': 'system',
  'system/crons': 'system',
  'system/jobs': 'system',
  'system/pos-events': 'system',
  'system/organization': 'system',
  'system/users': 'system',
  // Redirect-only groupings: they resolve where to send the viewer and never
  // render content of their own.
  organization: null,
  '': null,
  // Explains itself to an account with no organization; guarding it would be
  // circular.
  'no-access': null,
};

function routeKeyFor(pageFile: string) {
  const relative = path.relative(PROTECTED_ROOT, path.dirname(pageFile));
  return relative.split(path.sep).filter(Boolean).join('/');
}

function findPages(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return findPages(full);
    return entry.name === 'page.tsx' ? [full] : [];
  });
}

/**
 * A page is guarded by its own body or by a `layout.tsx` above it — which is how
 * a client component like the medical viewer gets covered at all.
 */
function guardSourceFor(pageFile: string) {
  let dir = path.dirname(pageFile);
  const sources = [fs.readFileSync(pageFile, 'utf8')];
  while (dir.startsWith(PROTECTED_ROOT)) {
    const layout = path.join(dir, 'layout.tsx');
    // The root protected layout only resolves the session; it guards nothing.
    if (fs.existsSync(layout) && dir !== PROTECTED_ROOT) {
      sources.push(fs.readFileSync(layout, 'utf8'));
    }
    dir = path.dirname(dir);
  }
  return sources.join('\n');
}

describe('protected page guards', () => {
  const pages = findPages(PROTECTED_ROOT);

  it('finds the route tree', () => {
    expect(pages.length).toBeGreaterThan(5);
  });

  it.each(pages.map((file) => [routeKeyFor(file) || '(root)', file]))(
    '%s decides access on the server',
    (routeKey, file) => {
      const key = routeKey === '(root)' ? '' : routeKey;
      expect(EXPECTED_GUARD).toHaveProperty(key);

      const expected = EXPECTED_GUARD[key];
      if (expected === null) return;

      const source = guardSourceFor(file as string);
      // System is not somewhere a regular account is ever meant to land, so
      // the guard sends them where they *can* go.
      expect(source).toContain('requireSystemAccess');
      expect(source).toContain("redirect('/')");
    },
  );

  it('guards every page the sidebar can link to', async () => {
    const { NAV_REQUIRED_FEATURE } = await import('@/app/lib/landing');

    // Nothing under /organization is feature-gated today; a page that showed
    // up here would need its own guard, which this suite would then fail on.
    expect(Object.keys(NAV_REQUIRED_FEATURE)).toHaveLength(0);
  });
});

/**
 * The routes behind the System pages have to refuse the request themselves.
 *
 * `app/(protected)/system/layout.tsx` shapes what a browser renders; it does
 * nothing to a caller posting straight at the API. Scanned from disk so a route
 * added under one of these folders without a guard fails here.
 */
describe('system route guards', () => {
  const SYSTEM_ROUTE_DIRS = [
    'app/api/users',
    'app/api/organizations',
    'app/api/system',
    'app/api/jobs',
    'app/api/chat-tester',
  ];

  // Routes under those folders that are deliberately not System-only.
  const OPEN_ROUTES = new Set([
    // The signed-in account acting on itself, which every session may do.
    'app/api/users/current/route.ts',
    'app/api/users/profile/route.ts',
    'app/api/users/password/route.ts',
    // Read by the tenant's own Chat widget page.
    'app/api/organizations/chat-branding/route.ts',
    // Backs the organization scope picker every signed-in user sees. It answers
    // with the caller's own authorized organizations, so the tenant boundary is
    // the result rather than the gate — requiring system access here is what
    // made the picker 403 for clinic users.
    'app/api/organizations/options/route.ts',
    // Receives a callback from the widget under test; authenticated by its own
    // payload, not by a session.
    'app/api/chat-tester/webhook/route.ts',
    // PUBLIC — no session yet. The invite token itself is the credential; see the
    // route's own doc comment for the rate-limit and error-shape reasoning.
    'app/api/organizations/claim/route.ts',
    // Backs the Estoque store picker every signed-in tenant session sees. It
    // answers with the caller's own authorized stores, same reasoning as
    // `organizations/options/route.ts` above.
    'app/api/organizations/stores/options/route.ts',
  ]);

  function findRoutes(dir: string): string[] {
    const full = path.join(process.cwd(), dir);
    if (!fs.existsSync(full)) return [];
    return fs.readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) return findRoutes(child);
      return entry.name === 'route.ts' ? [child] : [];
    });
  }

  const routes = SYSTEM_ROUTE_DIRS.flatMap(findRoutes).filter((file) => !OPEN_ROUTES.has(file));

  it('finds the system route set', () => {
    expect(routes.length).toBeGreaterThan(10);
  });

  it.each(routes)('%s requires system access', (file) => {
    const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
    expect(source).toContain('requireSystemAccess');
  });
});
