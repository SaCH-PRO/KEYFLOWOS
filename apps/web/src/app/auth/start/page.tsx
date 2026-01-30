import Link from "next/link";

export default function AuthStartPage() {
  return (
    <div className="landing">
      <div className="space-y-3">
        <h1 className="landing-title text-3xl md:text-4xl font-semibold">Begin Flow</h1>
        <p className="landing-tagline">
          Choose how you want to continue.
        </p>
      </div>
      <div className="flex w-full max-w-md flex-col gap-3 sm:flex-row sm:justify-center">
        <Link href="/auth/login" className="landing-button">
          Sign in
        </Link>
        <Link
          href="/auth/signup"
          className="inline-flex items-center justify-center rounded-full border border-slate-200/40 bg-slate-900/40 px-6 py-3 text-base font-semibold text-slate-100 transition-all hover:border-slate-100/70 hover:bg-slate-900/60"
        >
          Set up account
        </Link>
      </div>
      <p className="text-xs text-slate-300">
        New here? Create an account in minutes.
      </p>
    </div>
  );
}
