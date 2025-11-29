import Link from "next/link";

export default function Home() {
  return (
    <div className="landing">
      <h1 className="landing-title text-4xl md:text-5xl font-semibold">KEYFLOWOS</h1>
      <p className="landing-tagline">
        Where your business flows.
      </p>
      <Link href="/auth/login" className="landing-button">
        BEGIN FLOW
      </Link>
    </div>
  );
}
