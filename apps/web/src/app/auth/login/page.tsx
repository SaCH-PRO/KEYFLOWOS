"use client";

import { Suspense } from "react";
import LoginForm from "./login-form";

const isDev = process.env.NODE_ENV !== "production";

function DevCredentialsBanner() {
  if (!isDev) return null;
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl border border-[hsl(24_95%_53%/0.3)] bg-[hsl(24_95%_53%/0.08)] backdrop-blur-xl">
      <p className="text-xs text-[hsl(24_95%_63%)] font-medium text-center">
        Dev mode — sign in with <span className="font-bold">dev@keyflow.local</span> / <span className="font-bold">keyflowdev123</span>
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
