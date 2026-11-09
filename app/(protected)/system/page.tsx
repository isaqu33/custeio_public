import { redirect } from 'next/navigation';

/**
 * `/system` is a grouping, not a page.
 *
 * The sidebar parent and the breadcrumb root both link here, so it has to lead
 * somewhere instead of 404ing. Audit Events is the first child in the menu
 * (alphabetically first in both locales), so it is what the group opens on.
 */
export default function SystemIndexPage() {
  redirect('/system/audit-events');
}
