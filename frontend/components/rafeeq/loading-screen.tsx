import { cn } from "@/lib/utils"

// Base shimmering placeholder block
function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-xl", className)} />
}

function StatCardSkeleton() {
  return (
    <div className="glass rounded-2xl p-4">
      <Skeleton className="size-9 rounded-xl" />
      <Skeleton className="mt-4 h-8 w-24" />
      <Skeleton className="mt-2 h-3 w-32" />
    </div>
  )
}

/* Loading state for the Call Intelligence dashboard */
export function CallAnalysisLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading call analysis">
      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>

      {/* Filter bar */}
      <div className="glass flex flex-wrap items-center gap-3 rounded-2xl p-4">
        <Skeleton className="h-9 w-36" />
        <Skeleton className="h-9 w-36" />
        <Skeleton className="h-9 w-36" />
        <Skeleton className="ml-auto h-9 w-28" />
      </div>

      {/* Map */}
      <div className="glass grid gap-6 overflow-hidden rounded-2xl p-5 md:grid-cols-[260px_1fr] md:gap-0 md:p-0">
        <div className="flex flex-col gap-5 md:p-6">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-10 w-28" />
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        </div>
        <Skeleton className="h-[400px] w-full rounded-xl md:m-4 md:h-[560px] md:w-auto" />
      </div>

      {/* Table + charts */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-6">
          <Skeleton className="h-80 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
        <div className="flex flex-col gap-6">
          <Skeleton className="h-44 w-full rounded-2xl" />
          <Skeleton className="h-44 w-full rounded-2xl" />
          <Skeleton className="h-44 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  )
}

/* Loading state for the Cancellation Intelligence dashboard */
export function CancellationLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading cancellation intelligence">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1.5fr]">
        <Skeleton className="h-[360px] w-full rounded-xl" />
        <Skeleton className="h-[360px] w-full rounded-xl" />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Skeleton className="h-72 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
      <Skeleton className="h-96 w-full rounded-xl" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_3fr]">
        <Skeleton className="h-72 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    </div>
  )
}

/* Loading state for the CX Analytics dashboard */
export function CxDashboardLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading CX dashboard">
      <Skeleton className="h-16 w-full rounded-xl" />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[320px] w-full rounded-xl" />
        ))}
        <Skeleton className="h-72 w-full rounded-xl xl:col-span-2" />
      </div>
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  )
}

/* Loading state for the Support Messages dashboard */
export function MessagesLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading messages">
      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>

      {/* Negative triggers strip */}
      <Skeleton className="h-28 w-full rounded-2xl" />

      {/* Filter bar */}
      <div className="glass flex flex-wrap items-center gap-3 rounded-2xl p-4">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="ml-auto h-9 w-28" />
      </div>

      {/* Message feed */}
      <Skeleton className="h-96 w-full rounded-2xl" />

      {/* Charts */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[2fr_3fr]">
        <Skeleton className="h-64 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
      <Skeleton className="h-72 w-full rounded-2xl" />
    </div>
  )
}
