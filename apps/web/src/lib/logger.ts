import * as Sentry from "@sentry/nextjs";

/**
 * Production-safe logger. In development, messages go to the console.
 * In production, errors are sent to Sentry and warnings are silently
 * dropped (they already surface via the UI).
 */
export function logError(message: string, error?: unknown): void {
  if (process.env.NODE_ENV === "development") {
     
    console.error(message, error);
    return;
  }
  if (error instanceof Error) {
    Sentry.captureException(error, { extra: { message } });
  } else {
    Sentry.captureMessage(message, {
      level: "error",
      extra: { detail: error },
    });
  }
}

export function logWarn(message: string): void {
  if (process.env.NODE_ENV === "development") {
     
    console.warn(message);
  }
}
