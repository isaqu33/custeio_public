export default function DashboardLoading() {
  return (
    <div className="flex w-full flex-1 flex-col items-center">
      <div className="flex w-full max-w-[1400px] flex-1 flex-col gap-2">
        <div className="mt-3 flex flex-col gap-6 p-4 py-6 md:p-8">
          <div className="flex flex-col gap-1">
            <div className="h-8 w-40 animate-pulse rounded-md bg-muted" />
            <div className="h-4 w-64 animate-pulse rounded-md bg-muted" />
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-3 rounded-xl border bg-card p-5">
                <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                <div className="h-8 w-16 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>

          {/* Status breakdown + line chart */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="flex flex-col gap-4 rounded-xl border bg-card p-5">
              <div className="h-4 w-32 animate-pulse rounded bg-muted" />
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-1.5">
                  <div className="h-3 w-full animate-pulse rounded bg-muted" />
                  <div className="h-1.5 w-full animate-pulse rounded-full bg-muted" />
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-4 rounded-xl border bg-card p-5 lg:col-span-2">
              <div className="h-4 w-48 animate-pulse rounded bg-muted" />
              <div className="h-[200px] w-full animate-pulse rounded-lg bg-muted" />
            </div>
          </div>

          {/* Modality + Organization */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-4 rounded-xl border bg-card p-5">
                <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                <div className="h-[200px] w-full animate-pulse rounded-lg bg-muted" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
