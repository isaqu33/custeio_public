import { DataTableCard } from '@/components/data-table-shell';
import { Skeleton } from '@/components/ui/skeleton';

export default function LoadingCrons() {
  return (
    <div className="flex w-full flex-1 flex-col items-center">
      <div className="flex w-full max-w-[1400px] flex-1 flex-col gap-2">
        <div className="mt-3 flex flex-col gap-6 p-4 md:p-8 md:py-6">
          <div className="space-y-2">
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-4 w-96" />
          </div>
          {[2, 6].map((rows) => (
            <div key={rows} className="space-y-3">
              <Skeleton className="h-5 w-48" />
              <DataTableCard>
                <div className="flex flex-col gap-3 p-4">
                  {Array.from({ length: rows }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              </DataTableCard>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
