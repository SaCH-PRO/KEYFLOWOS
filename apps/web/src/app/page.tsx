import Link from "next/link";

export default function Home() {
  return (
    <div className="landing">
      <div className="w-full max-w-4xl space-y-6">
        <div className="space-y-4">
          <h1 className="landing-title text-3xl sm:text-4xl md:text-5xl font-semibold">KEYFLOWOS</h1>
          <p className="landing-tagline">
            Where your business flows. Unify contacts, bookings, payments, and automations in one command center.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/auth/login" className="landing-button">
            Sign in
          </Link>
          <Link href="/auth/signup" className="landing-button landing-button-secondary">
            Create workspace
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 text-left">
          {[
            { title: "CRM", desc: "Track every contact, task, and conversation in one place." },
            { title: "Bookings", desc: "Offer services, manage staff schedules, accept bookings." },
            { title: "Commerce", desc: "Create invoices, collect payments, monitor revenue." },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-primary/20 bg-slate-900/40 p-4 text-sm text-slate-200"
            >
              <div className="text-xs uppercase tracking-[0.2em] text-primary">{item.title}</div>
              <div className="mt-2 text-sm text-slate-200">{item.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
