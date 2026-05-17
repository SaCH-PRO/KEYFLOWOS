export function PageSkeleton() {
  return (
    <div className="min-h-screen p-6 animate-pulse">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header skeleton */}
        <div className="flex items-center justify-between">
          <div className="h-8 w-48 bg-muted rounded" />
          <div className="h-10 w-32 bg-muted rounded" />
        </div>
        {/* Content cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="h-32 bg-muted rounded-xl" />
          <div className="h-32 bg-muted rounded-xl" />
          <div className="h-32 bg-muted rounded-xl" />
        </div>
        {/* Main content area */}
        <div className="h-96 bg-muted rounded-xl" />
      </div>
    </div>
  );
}
