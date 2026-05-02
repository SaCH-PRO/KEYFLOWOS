import Link from "next/link";
import { FileQuestion, Home } from "lucide-react";

export default function RootNotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md w-full rounded-xl border border-border/60 bg-slate-900/80 backdrop-blur-xl p-8 text-center space-y-6">
        <div className="mx-auto w-16 h-16 rounded-full bg-orange-500/10 flex items-center justify-center">
          <FileQuestion className="w-8 h-8 text-orange-400" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-foreground mb-2">Page not found</h2>
          <p className="text-sm text-muted-foreground">
            The page you are looking for does not exist or has been moved.
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium transition-colors"
        >
          <Home className="w-4 h-4" />
          Home
        </Link>
      </div>
    </div>
  );
}
