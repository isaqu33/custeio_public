import { NextResponse } from 'next/server';
import { HttpStatus } from '@/app/lib/http-status';
import { withPublicObservability } from '@/app/lib/observability';
import { recordAlloyWebhook } from '@/app/lib/services/pos-events';
import { enqueuePosOrderReceived } from '@/app/lib/services/pos-order-enqueue';

export const dynamic = 'force-dynamic';

/**
 * Alloy's order webhook (docs/features/alloy-api.md). Public by path, authenticated by the
 * "Chave" the owner registers in Alloy: sent as `Authorization: Bearer <chave>` and as
 * `chave` in the body. Alloy waits 3 seconds for `{"status":"ok"}` and disables a
 * webhook that keeps answering something else, so everything slow stays out of here: the
 * delivery is recorded and handed to the worker (`pos.order.received`). It also validates a new webhook with an empty `{}` POST.
 */
export const POST = withPublicObservability('alloy.webhook', async (req) => {
  const { result, eventId, storeId } = await recordAlloyWebhook({
    authorization: req.headers.get('authorization'),
    rawBody: await req.text(),
  });

  if (result === 'unauthorized') {
    return NextResponse.json({ status: 'error' }, { status: HttpStatus.UNAUTHORIZED });
  }

  // Turning the order into a stock debit is the worker's job. The event is already stored, so a
  // failure to enqueue must not fail the delivery (Alloy would re-send and then disable the webhook).
  if (result === 'recorded' && eventId && storeId) {
    await enqueuePosOrderReceived({ storeId, eventId });
  }
  return NextResponse.json({ status: 'ok' }, { status: HttpStatus.OK });
});
