'use client';

import { API_BASE } from '@/lib/api';

export default function EnvCheckPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 space-y-3">
      <h1 className="text-3xl font-bold">Environment Check</h1>
      <p className="text-slate-700">NEXT_PUBLIC_API_BASE_URL resolved to:</p>
      <code className="rounded bg-slate-100 px-3 py-2 text-sm">{API_BASE}</code>
    </main>
  );
}
