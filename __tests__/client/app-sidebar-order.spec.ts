import { getSidebarNavItems } from '@/components/app-sidebar-nav';
import { DICTIONARIES } from '@/app/lib/i18n/dictionary';

function titlesByGroup(locale: 'en-US' | 'pt-BR') {
  return getSidebarNavItems(DICTIONARIES[locale], locale).map((group) => ({
    group: group.title,
    items: group.items?.map((item) => item.title) ?? [],
  }));
}

describe('sidebar order', () => {
  it('keeps User before System', () => {
    expect(titlesByGroup('en-US').map((g) => g.group)).toEqual(['User', 'System']);
  });

  it.each(['en-US', 'pt-BR'] as const)(
    'orders Organization as Dashboard, Stock, Preparations, Invoices, Prices, Products, Add-ons, Orders, Sales, Internal use regardless of locale (%s)',
    (locale) => {
      const urls = getSidebarNavItems(DICTIONARIES[locale], locale)
        .find((group) => group.url === '/organization')
        ?.items?.map((item) => item.url);
      expect(urls).toEqual([
        '/organization/dashboard',
        '/organization/stock',
        '/organization/preparations',
        '/organization/invoices',
        '/organization/prices',
        '/organization/products',
        '/organization/modifiers',
        '/organization/orders',
        '/organization/sales',
        '/organization/internal-use',
      ]);
    },
  );

  it.each(['en-US', 'pt-BR'] as const)('sorts %s System entries alphabetically', (locale) => {
    const items = titlesByGroup(locale).find(
      (g) => g.group === DICTIONARIES[locale].navigation.system,
    )?.items;
    const sorted = [...(items ?? [])].sort((a, b) =>
      a.localeCompare(b, locale, { sensitivity: 'base' }),
    );
    expect(items).toEqual(sorted);
  });
});

describe('sidebar access filtering', () => {
  const copy = DICTIONARIES['pt-BR'];

  function urls(access: Parameters<typeof getSidebarNavItems>[2]) {
    return getSidebarNavItems(copy, 'pt-BR', access)
      .flatMap((group) => group.items ?? [])
      .map((item) => item.url);
  }

  it('shows everything for a bypass account', () => {
    const shown = urls({ features: null, hasSystemAccess: true });
    expect(shown).toContain('/system/jobs');
    expect(shown).toContain('/system/users');
  });

  it('keeps the whole System group out of a non-system menu', () => {
    const shown = urls({ features: new Set(), hasSystemAccess: false });
    // Platform administration is not feature-managed: no feature set opens any
    // of it, which is what `app/(protected)/system/layout.tsx` enforces.
    expect(shown.filter((url) => url.startsWith('/system'))).toEqual([]);
  });

  it('drops the System heading itself for a non-system account', () => {
    const groups = getSidebarNavItems(copy, 'pt-BR', {
      features: new Set(),
      hasSystemAccess: false,
    });
    // Left in place it would be a heading that navigates to a redirect the
    // viewer bounces straight back out of.
    expect(groups.map((group) => group.url)).not.toContain('/system');
  });

  it('keeps the User heading up with no feature grants at all, for the ungated placeholder', () => {
    // Nothing gates the dashboard placeholder today, so unlike System the User
    // group can never end up fully empty.
    const groups = getSidebarNavItems(copy, 'pt-BR', {
      features: new Set(),
      hasSystemAccess: false,
    });
    expect(groups.map((group) => group.url)).toContain('/organization');
    // Fixed order: Dashboard, Stock, Preparations, Invoices, Prices, Products, Add-ons, Orders, Sales, Internal use.
    expect(groups.find((group) => group.url === '/organization')?.items).toEqual([
      expect.objectContaining({ url: '/organization/dashboard' }),
      expect.objectContaining({ url: '/organization/stock' }),
      expect.objectContaining({ url: '/organization/preparations' }),
      expect.objectContaining({ url: '/organization/invoices' }),
      expect.objectContaining({ url: '/organization/prices' }),
      expect.objectContaining({ url: '/organization/products' }),
      expect.objectContaining({ url: '/organization/modifiers' }),
      expect.objectContaining({ url: '/organization/orders' }),
      expect.objectContaining({ url: '/organization/sales' }),
      expect.objectContaining({ url: '/organization/internal-use' }),
    ]);
  });
});
