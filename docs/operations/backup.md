# Backup and restore

Stock, recipes and the cost/CMV history of every organization live only in MongoDB. Losing that
volume without a backup means losing the record of what Custeio told the store owner. This is
the minimum that prevents it.

## Taking one

```bash
npm run ops:backup                      # writes ./backups/custeio-<stamp>.archive.gz
BACKUP_DIR=/mnt/backups npm run ops:backup
```

It depends only on `docker` (it runs `mongodump` inside the `mongo-custeio` container) or on a
local `mongodump` if there is no container. Credentials come from the same `.env` the application
reads, so a backup cannot diverge from the database it protects. An archive smaller than 1 KB is
deleted and the script fails: a truncated dump that looks like a backup is worse than no backup.

`BACKUP_KEEP` (14) prunes older archives in that directory.

## Proving one

A backup that was never restored is a hypothesis. The restore, by default, goes to a **side
database** (`custeio_restore_check`), so the test is safe to run against production:

```bash
npm run ops:restore -- backups/custeio-20260919-114213.archive.gz --yes
```

That lands in `custeio_restore_check`. Compare against the live database before trusting it —
the script prints the exact command, which shows the document count per collection side by side.

To restore over the live database, name it explicitly: `--db custeio --yes`. The script warns
loudly that the archive's collections are dropped first.

**Not yet verified since the pivot to the Custeio domain.** The last time this process was
proven (2026-08-25) was against an older schema — not
against today's `RawIngredients`/`PartnerProducts`/`Orders`/`Stores`. Running the proof above at
least once before trusting this with real client data is the most concrete item of the
[go-live-checklist.md](./go-live-checklist.md).

## Scheduling

There is no scheduler inside the application; use the host's. On the Docker host:

```cron
17 3 * * *  cd /opt/custeio && BACKUP_DIR=/mnt/backups ./scripts/ops/backup-mongo.sh >> /var/log/custeio-backup.log 2>&1
```

Then **copy `$BACKUP_DIR` off that machine** — to Azure Blob, another host, anywhere that does not
die with it. A backup on the same disk as the database survives a dropped collection and nothing
beyond that.

## What this does NOT cover

`mongodump` copies MongoDB. It does not copy the **blob storage**, which today holds:

- item/category images and the organization logo (through `AzuriteBlobAdapter`, see
  [`app/lib/azure-blob-storage.ts`](../../app/lib/azure-blob-storage.ts)),
- and, once SEFAZ NFe capture is implemented, **each client's A1 certificate** — see
  [sefaz-nfe.md](../features/sefaz-nfe.md), which is a far more critical piece of data to lose (or
  to leak) than a menu image.

Those things live in the account's Azure container. Azure's own tools are the right answer here —
turn on **soft delete** and **versioning** on the storage account, which costs nothing to enable
and protects against the realistic accident (a wrong deletion), and use `azcopy sync` if you want
a second copy. Until that is done, a restored database points to images/files that may no longer
exist.

Redis deliberately has no backup: it holds the queue and rate-limit counters, nothing that cannot
be rebuilt.
