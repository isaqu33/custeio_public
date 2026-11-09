import {
  BriefcaseBusiness,
  Building2,
  ChefHat,
  ClipboardList,
  Clock,
  Cog,
  LayoutDashboard,
  FileText,
  ListPlus,
  Package,
  ChartColumn,
  ReceiptText,
  TrendingUp,
  UserRound,
  UtensilsCrossed,
  UsersIcon,
  Webhook,
} from 'lucide-react';
import type { NavItem } from '@/components/nav-main';
import type { AppCopy } from '@/app/lib/i18n/dictionary';
import { NAV_REQUIRED_FEATURE } from '@/app/lib/landing';

/**
 * What the viewer may reach, as the sidebar needs it.
 *
 * `features: null` is the System/Support bypass. `hasSystemAccess` is separate
 * because System entries are not group-managed — no group can grant its way
 * into platform administration.
 */
export type SidebarAccess = {
  features: Set<string> | null;
  hasSystemAccess: boolean;
};

/** Full access, so callers that do not care about gating (tests, stories) opt out. */
const FULL_ACCESS: SidebarAccess = { features: null, hasSystemAccess: true };

// Two groups, mirroring the route layout: Usuário holds what a tenant works with
// day to day, System holds platform administration (only the operator reaches
// it). The groups keep their declared order.
//
// Organization follows the fixed, curated order in `FIXED_ITEM_ORDER` below
// (Dashboard, then Stock, then Products) — that is the order the owner works
// through the pipeline in, not alphabetical. System has no entry there, so it
// keeps the older rule: entries sorted by the ACTIVE locale's label, with a menu this long, a reader scanning
// for one entry beats any curated "importance" order we could invent, and
// sorting by locale (not a fixed declaration order) means a list hand-sorted
// in English doesn't read as unsorted in pt-BR.
//
// Built per render so the labels follow the dictionary; `url` is what drives
// the active state.

// Curated order for a group's entries, keyed by group `url`; a group left out
// falls back to alphabetical-by-locale. Only lists item `url`s — an item not
// named here (a page added later) sorts after the named ones, alphabetically.
const FIXED_ITEM_ORDER: Record<string, string[]> = {
  '/organization': [
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
  ],
};
export function getSidebarNavItems(
  copy: AppCopy,
  locale: string,
  access: SidebarAccess = FULL_ACCESS,
): NavItem[] {
  const groups: NavItem[] = [
    {
      title: copy.navigation.organization,
      url: '/organization',
      icon: Building2,
      items: [
        {
          title: copy.navigation.dashboard,
          url: '/organization/dashboard',
          icon: LayoutDashboard,
        },
        {
          title: copy.navigation.stock,
          url: '/organization/stock',
          icon: Package,
        },
        {
          title: copy.navigation.preparations,
          url: '/organization/preparations',
          icon: ChefHat,
        },
        {
          title: copy.navigation.invoices,
          url: '/organization/invoices',
          icon: FileText,
        },
        {
          title: copy.navigation.prices,
          url: '/organization/prices',
          icon: TrendingUp,
        },
        {
          title: copy.navigation.products,
          url: '/organization/products',
          icon: UtensilsCrossed,
        },
        {
          title: copy.navigation.modifiers,
          url: '/organization/modifiers',
          icon: ListPlus,
        },
        {
          title: copy.navigation.orders,
          url: '/organization/orders',
          icon: ReceiptText,
        },
        {
          title: copy.navigation.sales,
          url: '/organization/sales',
          icon: ChartColumn,
        },
        {
          title: copy.navigation.internalUse,
          url: '/organization/internal-use',
          icon: UserRound,
        },
      ],
    },
    {
      title: copy.navigation.system,
      url: '/system',
      icon: Cog,
      items: [
        {
          title: copy.navigation.auditEvents,
          url: '/system/audit-events',
          icon: ClipboardList,
        },
        {
          title: copy.navigation.jobs,
          url: '/system/jobs',
          icon: BriefcaseBusiness,
        },
        {
          title: copy.navigation.crons,
          url: '/system/crons',
          icon: Clock,
        },
        {
          title: copy.navigation.posEvents,
          url: '/system/pos-events',
          icon: Webhook,
        },
        {
          title: copy.navigation.organizations,
          url: '/system/organization',
          icon: Building2,
        },
        {
          title: copy.navigation.users,
          url: '/system/users',
          icon: UsersIcon,
        },
      ],
    },
  ];

  // Hiding is a convenience, not the guard: `app/(protected)/system/layout.tsx`
  // and each organization page repeat the check server side, because a bookmark
  // or a typed URL never passes through this menu.
  //
  // Everything under System is platform administration and none of it is
  // group-managed — no group can grant its way in, which is what having a bypass
  // level means. Organization entries are decided by the feature behind them.
  const canOpen = (url: string) => {
    if (url.startsWith('/system')) return access.hasSystemAccess;
    const required = NAV_REQUIRED_FEATURE[url];
    if (!required) return true;
    return access.features === null || access.features.has(required);
  };

  return (
    groups
      .map((group) => {
        const fixedOrder = FIXED_ITEM_ORDER[group.url];
        const sortItems = fixedOrder
          ? (a: NavItem, b: NavItem) => {
              const ai = fixedOrder.indexOf(a.url);
              const bi = fixedOrder.indexOf(b.url);
              if (ai === -1 && bi === -1)
                return a.title.localeCompare(b.title, locale, { sensitivity: 'base' });
              if (ai === -1) return 1;
              if (bi === -1) return -1;
              return ai - bi;
            }
          : (a: NavItem, b: NavItem) =>
              a.title.localeCompare(b.title, locale, { sensitivity: 'base' });

        return {
          ...group,
          items: group.items
            ? [...group.items].filter((item) => canOpen(item.url)).sort(sortItems)
            : undefined,
        };
      })
      // A group whose every entry is hidden would render as a dead heading that
      // navigates to a page the viewer cannot open.
      .filter((group) => (group.items ? group.items.length > 0 : true))
  );
}
