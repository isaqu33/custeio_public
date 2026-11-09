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

export default function LoadingJobs() {
  return (
    <div className="flex w-full flex-1 flex-col items-center">
      <div className="flex w-full max-w-[1400px] flex-1 flex-col gap-2">
        <div className="mt-3 flex flex-col gap-4 p-4 md:p-8 md:py-6">
          {/* HEADER SKELETON — matches text-2xl title + subtitle */}
          <div className="space-y-2">
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-4 w-80" />
          </div>

          {/* TOP ROW SKELETON — search + create-job button */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Skeleton className="h-9 w-[260px]" />
            <Skeleton className="h-9 w-36" />
          </div>

          {/* FILTERS SKELETON — kind select + 2 date inputs + apply/clear */}
          <div className="grid gap-2 md:grid-cols-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <div className="flex gap-2">
              <Skeleton className="h-9 flex-1" />
              <Skeleton className="h-9 flex-1" />
            </div>
          </div>

          {/* TABLE SKELETON — same 5 columns as DataTableJobs */}
          <DataTableCard>
            <div className="flex w-full justify-end gap-2 border-b bg-muted/30 px-4 py-3">
              <Skeleton className="size-8" />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Exam ID</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created At</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-4 w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-40" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-6 w-20 rounded-full" />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-3 w-12" />
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Skeleton className="ml-auto size-8" />
                    </TableCell>
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
