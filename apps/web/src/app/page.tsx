import { Button } from "@keyflow/ui";
import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-4">KeyFlow OS</h1>
      <p className="mb-8">Web App is running.</p>
      <Button>Test Button from UI Package</Button>
      <Link className="mt-6 text-blue-600 underline" href="/book">
        Go to Public Booking Test
      </Link>
      <Link className="mt-2 text-blue-600 underline" href="/social">
        Go to Social Post Test
      </Link>
    </main>
  );
}
