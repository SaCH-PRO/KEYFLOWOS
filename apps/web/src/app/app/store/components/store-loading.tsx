export function StoreLoading() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-24 rounded-2xl animate-pulse"
            style={{ background: "hsl(var(--kf-muted) / 0.3)" }}
          />
        ))}
      </div>
      <div className="h-12 rounded-xl animate-pulse w-64" style={{ background: "hsl(var(--kf-muted) / 0.3)" }} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-32 rounded-2xl animate-pulse"
            style={{ background: "hsl(var(--kf-muted) / 0.3)" }}
          />
        ))}
      </div>
    </div>
  );
}
