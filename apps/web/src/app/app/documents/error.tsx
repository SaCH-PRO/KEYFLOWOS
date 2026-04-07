"use client";

export default function DocumentsError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
      <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">Something went wrong</h2>
      <p className="text-sm text-[hsl(var(--muted-foreground))]">{error.message || "Failed to load documents"}</p>
      <button
        type="button"
        onClick={reset}
        className="px-4 py-2 rounded-lg bg-[hsl(var(--kf-accent1))] text-white text-sm font-medium min-h-[44px]"
      >
        Try again
      </button>
    </div>
  );
}
