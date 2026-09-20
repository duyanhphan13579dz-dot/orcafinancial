/**
 * Root loading UI — shown immediately on navigation while the target
 * server component resolves. Keep it extremely light (no data, no charts).
 */
export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse" aria-busy="true" aria-label="Đang tải">
      <div className="flex items-center justify-between gap-3">
        <div className="h-7 w-40 rounded-md bg-[#0e2e4f]" />
        <div className="h-8 w-28 rounded-md bg-[#0e2e4f]" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="panel p-4 space-y-3">
            <div className="h-3 w-16 rounded bg-[#1a3558]" />
            <div className="h-6 w-24 rounded bg-[#1a3558]" />
            <div className="h-3 w-12 rounded bg-[#1a3558]/70" />
          </div>
        ))}
      </div>

      <div className="panel p-4 space-y-3">
        <div className="h-4 w-32 rounded bg-[#1a3558]" />
        <div className="h-40 w-full rounded-lg bg-[#0e2e4f]" />
        <div className="grid grid-cols-3 gap-2">
          <div className="h-3 rounded bg-[#1a3558]/60" />
          <div className="h-3 rounded bg-[#1a3558]/40" />
          <div className="h-3 rounded bg-[#1a3558]/50" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="panel p-4 h-36" />
        <div className="panel p-4 h-36" />
      </div>
    </div>
  );
}
