import { Button } from "@keyflow/ui";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-4">KeyFlow OS</h1>
      <p className="mb-8">Web App is running.</p>
      <Button>Test Button from UI Package</Button>
    </main>
  );
}