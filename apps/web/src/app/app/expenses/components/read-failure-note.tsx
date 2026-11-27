"use client";

import type { BlockRead } from "./use-expenses-data";

/**
 * EXPENSES-HUB-3 R24b (D-315): a block whose own read was refused or failed says so, in the failure kit's words
 * ("Couldn't load <what>: <the server's words>", or no access), with Retry where reading again can help. It never
 * shows the block's empty state, which would say there is nothing.
 */
export function readFailure(read: BlockRead | undefined): string | null {
  if (!read || read.kind === "ok" || read.kind === "loading") return null;
  return read.message;
}

export function ReadFailureNote({ read, onRetry, className }: { read: BlockRead | undefined; onRetry?: () => void; className?: string }) {
  const message = readFailure(read);
  if (!message) return null;
  return (
    <p role="status" className={className ?? "text-xs text-muted-foreground"}>
      {message}
      {onRetry && read?.kind === "failed" && (
        <>
          {" "}
          <button type="button" onClick={onRetry} className="underline underline-offset-2 hover:text-foreground">
            Retry
          </button>
        </>
      )}
    </p>
  );
}
