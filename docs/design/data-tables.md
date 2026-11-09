# Data tables — the "Card elevado" pattern

## Why this exists

Every listing page in Custeio (Users, Organizations, Jobs, Audit Events, Stores, Stock) was, until
2026-09-22, the unmodified shadcn/ui default: a bare `rounded-md border` box, a `bg-secondary` toolbar
strip, plain-case table headers. That is the same starting point most admin dashboards ship with —
indistinguishable from the boilerplate this project was forked from, or from any other shadcn
dashboard a visitor may have seen elsewhere. This doc codifies the replacement so every **new** page
picks it up automatically instead of reintroducing the default look.

The direction (there were three candidates — a spacious/editorial layout and a dense-grid layout were
the other two) is an elevated card: the same floating, soft-shadow treatment already used by the
sidebar panels and `FilterShell`, applied to the table itself, with a refined header row and a
brand-tinted (not generic gray) row hover.

## The pieces

| Piece                                                    | File                              | Role                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Card`                                                   | `components/ui/card.tsx`          | The shared floating-card primitive: `rounded-xl border` + a soft two-layer shadow. Not new — already used by the sidebar and dialogs.                                                                                                                                      |
| `FilterShell`                                            | `components/filter-shell.tsx`     | The search/filter card **above** the table. Now built on `Card` so it visually stacks with the table as one family instead of two different boxes.                                                                                                                         |
| `DataTableCard`                                          | `components/data-table-shell.tsx` | Wraps the whole table in a `Card`, `overflow-hidden` so the table's square corners clip to the card's rounded ones.                                                                                                                                                        |
| `DataTableToolbar`                                       | `components/data-table-shell.tsx` | The row-scoped action bar (create, refresh) inside the card, above `<Table>`. `justify-end` by default; most tables override to `justify-between` — see [Toolbar layout](#toolbar-layout-and-button-style) below. Page-level filtering belongs in `FilterShell`, not here. |
| `DataTableFooter`                                        | `components/data-table-shell.tsx` | The pagination row inside the card, below `<Table>`.                                                                                                                                                                                                                       |
| `Table`/`TableHeader`/`TableHead`/`TableCell`/`TableRow` | `components/ui/table.tsx`         | The primitives themselves carry the refined look (see below) — nothing more to opt into at the call site.                                                                                                                                                                  |

## What changed in the shared primitives

- **`TableHeader`**: a subtle `bg-muted/40` wash instead of a bare border, so the header reads as its
  own zone without a heavy rule.
- **`TableHead`**: `text-xs font-semibold uppercase tracking-wide` instead of `font-medium` at body
  size — the "premium admin dashboard" label treatment (Linear/Stripe-style), and a `px-3` bump from
  `px-2` for a touch more breathing room.
- **`TableCell`**: `p-3` instead of `p-2` — same reasoning, kept modest so density stays close to what
  it was (this is an operational tool, not a marketing page).
- **`TableRow`**: hover is `hover:bg-accent/60` and selected is `bg-accent` — `--accent` is the pale
  brand-teal tint (see `app/globals.css`), so the interaction color is on-brand instead of neutral
  gray.

Because these are the shared primitives, every consumer of `@/components/ui/table` picked up the new
look automatically — no table-specific overrides needed.

## The shape every listing follows

```tsx
<div className="w-full">
  {/* Optional: page-level search/filter, own card, above the table. */}
  <SearchFilter … /> {/* or <FilterShell><FilterRow>…</FilterRow></FilterShell> */}

  <DataTableCard>
    <DataTableToolbar className="justify-between">
      {/* utility action(s) — refresh, filters — on the left */}
      <ActionButton action="refresh" variant="ghost" label={copy.common.refreshTable} … />
      {/* the one action that creates something stands alone on the right */}
      <ModalXCreate />
    </DataTableToolbar>

    <Table>
      <TableHeader>…</TableHeader>
      <TableBody>…</TableBody>
    </Table>

    <DataTableFooter>
      <Pagination>…</Pagination>
    </DataTableFooter>
  </DataTableCard>
</div>
```

- No pagination → omit `DataTableFooter` entirely (see `data-table-raw-ingredients.tsx`, which has no
  pagination today).
- No toolbar actions at all → omit `DataTableToolbar`; don't render it empty.
- Only one toolbar action and nothing to balance it against (`table-audit-events.tsx`, no create) →
  `justify-start` instead, so the lone button doesn't default to the far right.
- Loading skeletons (`app/(protected)/system/*/loading.tsx`) wrap their skeleton rows in
  `DataTableCard` too, so the loading state doesn't flash a different shape than the loaded one.

## Toolbar layout and button style

Rolled out 2026-09-22, on top of the card shell above — three more deviations from the shadcn
default, all in service of the same goal: don't look like the boilerplate.

**Toolbar buttons carry visible text, never just an icon.** The shadcn default (and the app's own
starting point) was an icon-only square button with a tooltip as the only label — `data-table-raw-
ingredients.tsx`'s "Novo insumo" button was the first to break that, and it's now the rule: drop
`iconOnly` on `ActionButton` and it falls back to `copy.common[action]`, or pass `label`/children for
something more specific ("Criar organização" beats generic "Criar"). Row-level actions (the icon
buttons inside a table cell — edit, delete, reset password) are the one exception: a table row has no
room for six labelled buttons, so those stay icon-only with a `title` tooltip.

**Toolbar buttons split left/right by weight, not by menu order.** The action that creates something
is the one thing on the page worth a solid, prominent button — it stands alone on the right
(`DataTableToolbar`'s default `justify-end`, or the right side of `justify-between`). Everything else
— refresh, a status filter `Select` — is secondary and groups on the left. This is a genuine position
change from the original layout, where every toolbar button was clustered together on the right
regardless of importance.

**Row-action icon buttons are ghost and circular, not bordered squares.** `ActionButton`'s `iconOnly`
styling (`components/ui/action-button.tsx`) now applies `rounded-full border-transparent bg-transparent
shadow-none hover:bg-accent` — this wins over whatever `variant` a call site still passes (e.g.
`variant="outline"`) because it's appended later in the `cn()`/tailwind-merge chain, so no call site
needed to change. The handful of row actions built on a raw `<Button>` instead of `ActionButton`
(`table-organization.tsx`'s audit-events link and lock/unlock, `table-jobs.tsx`'s download,
`job-detail-modal.tsx`, `modal-organization-invite.tsx`, `modal-organization-stores.tsx`,
`modal-organization-billing.tsx`, `user-modal-organization.tsx`) were switched to `variant="ghost"` +
`className="rounded-full"` by hand, since they don't go through the shared component.

## Page header

`PageShell`/`PageHeader` (`components/page-shell.tsx`) take an optional `icon` (a `LucideIcon`),
rendered as a small `rounded-xl bg-primary/10 text-primary` badge to the left of the title — the same
icon the page's sidebar entry uses (`UsersIcon`, `Building2`, `BriefcaseBusiness`, `ClipboardList`,
`Package`, `LayoutDashboard`). Every page in `app/(protected)/{organization,system}/*/page.tsx` passes
one; a new page should too.

## Applying this to a new listing page

1. Import `DataTableCard`, `DataTableToolbar`, `DataTableFooter` from `@/components/data-table-shell`.
2. Follow the shape above: `justify-between` with refresh/filters on the left, the create action alone
   on the right; every toolbar `ActionButton` shows text, never `iconOnly`.
3. Row actions inside `<TableCell>` stay `iconOnly` — `ActionButton` already renders them ghost and
   circular, nothing to opt into.
4. If the page has search/filtering, use `SearchFilter` or `FilterShell`/`FilterRow`/`FilterActions`
   from `components/filter-shell.tsx` — already on the same `Card` treatment.
5. Pass `icon` to `PageShell`, matching the page's entry in `components/app-sidebar-nav.ts`.
6. Don't reach for a bare `<div className="rounded-md border">` or a bordered `variant="outline"` icon
   button — if you find yourself writing either, use `DataTableCard` / the `ActionButton` default
   instead.

## Rolled out to (2026-09-22)

`table-users.tsx`, `table-organization.tsx`, `table-jobs.tsx`, `table-audit-events.tsx`,
`data-table-organization-stores.tsx`, `data-table-organization-users.tsx`,
`data-table-raw-ingredients.tsx`, the four System `loading.tsx` skeletons, every `page.tsx` under
`app/(protected)/{organization,system}/*`, and the row-action buttons listed above.
