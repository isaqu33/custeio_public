import { Skeleton } from '@/components/ui/skeleton';
import { DataTableCard } from '@/components/data-table-shell';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export default function LoadingAuditEvents() {
  return (
    <div className="flex w-full flex-1 flex-col items-center">
      <div className="flex w-full max-w-[1400px] flex-1 flex-col gap-2">
        <div className="mt-3 flex flex-col gap-4 p-4 md:p-8 md:py-6">
          {/* HEADER SKELETON — matches text-2xl title + subtitle */}
          <div className="space-y-2">
            <Skeleton className="h-7 w-44" />
            <Skeleton className="h-4 w-96" />
          </div>

          {/* FILTER CARD SKELETON — label + control for 4 fields, then 3 icon buttons */}
          <div className="w-full rounded-lg border bg-card p-4">
            <div className="flex flex-col items-stretch gap-3 lg:flex-row lg:items-end">
              <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-[160px_160px_220px_1fr]">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-9 w-full" />
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Skeleton className="size-9" />
                <Skeleton className="size-9" />
                <Skeleton className="size-9" />
              </div>
            </div>
          </div>

          {/* TABLE SKELETON — same 8 columns as DataTableAuditEvents */}
          <DataTableCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTableCard>
        </div>
      </div>
    </div>
  );
}
