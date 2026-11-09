import { type CronRow, listCrons } from '@/app/lib/services/crons';
import { type SefazPollingStore, listSefazPollingStores } from '@/app/lib/services/sefaz-polling';

export type CronsOverview = {
  crons: CronRow[];
  stores: SefazPollingStore[];
};

/** Everything the Crons screen shows, in one read shared by the page and its API. */
export async function getCronsOverview(): Promise<CronsOverview> {
  const [crons, stores] = await Promise.all([listCrons(), listSefazPollingStores()]);
  return { crons, stores };
}
