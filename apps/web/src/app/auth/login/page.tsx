"use client";

import { Suspense } from "react";
import LoginForm from "./login-form";

export default function AuthLoginPage() {
  return (
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
  );
}
