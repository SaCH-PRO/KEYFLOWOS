"use client";

import { Suspense } from "react";
import LoginForm from "./login-form";

const isDev = process.env.NODE_ENV === "development";

function DevCredentialsBanner() {
  if (!isDev) return null;
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl border border-[hsl(24_95%_53%/0.3)] bg-[hsl(24_95%_53%/0.08)] backdrop-blur-xl">
      {/* The seed password is generated per seed rather than committed to
          source, so it cannot be printed here. SeedService logs it once in the
          API boot banner; KEYFLOW_DEV_PASSWORD pins it if you would rather not
          read the log after every database reset. */}
      <p className="text-xs text-[hsl(24_95%_63%)] font-medium text-center">
        Dev mode — sign in as <span className="font-bold">dev@keyflow.local</span>; the password is
        printed once in the API boot log (or set <span className="font-bold">KEYFLOW_DEV_PASSWORD</span>)
      </p>
    </div>
  );
}

export default function AuthLoginPage() {
  return (
    <>
      <DevCredentialsBanner />
      <Suspense fallback={
        <div className="min-h-screen flex items-center justify-center bg-[hsl(20_14%_4%)]">
          <div className="flex flex-col items-center gap-4">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-[hsl(24_95%_53%)] border-t-transparent" />
            <p className="text-sm text-[hsl(30_10%_55%)]">Loading...</p>
          </div>
        </div>
      }>
        <LoginForm />
      </Suspense>
    </>
  );
}
