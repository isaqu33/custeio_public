# Knowing the pipeline stopped

## Current state: the mechanism was archived, it does not exist today

There is no queue watchdog yet: no worker heartbeat in Redis, no queue-depth alert and no push to a
chat webhook when the worker dies or the queue chokes.

- `APP_HEALTH_WORKER_SILENT_MS`, `APP_HEALTH_QUEUE_BACKLOG_MAX`, `APP_HEALTH_QUEUE_FAILED_MAX`,
  `APP_ALERT_WEBHOOK_URL`, `APP_ALERT_REPEAT_MS` and `APP_PIPELINE_WATCHDOG_INTERVAL_MS` are still
  declared in [`app/lib/env.ts`](../../app/lib/env.ts), but **have no consumer** — orphaned
  configuration, the same situation we found in [retention.md](./retention.md).
- What remains is only the generic container health check:
  [`/api/health`](../../app/api/health/route.ts), `/api/health/ready` (can it talk to Mongo/Redis?)
  and `/api/health/live`. None of them answers "are the jobs actually moving" — which is exactly
  the gap the archived mechanism existed to cover.

## Why this matters now, not just later

The sentence that used to be here still holds, and has become true again: **a worker that dies at
2 a.m. is only discovered when a client complains** — because today nothing watches whether
`pos.order.received`/`sefaz.nfe.received`/`whatsapp.message.incoming` (none of the three
implemented yet, see [`CLAUDE.md`](../../CLAUDE.md)) are being processed or stuck in the queue.

## What has to happen before these jobs go to production

Build the idea (worker heartbeat + queue size + a push to a webhook, a normal backlog told apart from a
stopped queue, one message per incident). It makes no sense to build this **before**
at least one domain job is really running — see [go-live-checklist.md](./go-live-checklist.md) for
when this becomes blocking.
