"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export default function Home() {
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className={`relative min-h-screen flex flex-col items-center justify-center px-6 text-center gap-8 overflow-hidden ${
      mounted && theme === "light" ? "bg-white" : "bg-black"
    }`}>
      <div className="relative z-10 space-y-6">
        <h1 
          className="text-5xl md:text-7xl font-bold tracking-tight"
          style={{ color: "hsl(var(--kf-accent1))" }}
        >
          KEYFLOW
        </h1>
        
        <p className={`text-lg md:text-xl max-w-xl mx-auto ${
          mounted && theme === "light" ? "text-gray-600" : "text-gray-400"
        }`}>
          Where your business flows. The operating system for service businesses.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mt-8">
          <Link 
            href="/auth/login" 
            className="px-8 py-3 rounded-xl text-white font-semibold text-lg transition-all hover:opacity-90 hover:scale-105"
            style={{ background: "hsl(var(--kf-accent1))" }}
          >
            Get Started
          </Link>
          <Link 
            href="/app" 
            className="px-8 py-3 rounded-xl font-semibold text-lg transition-all hover:opacity-80"
            style={{
              background: "hsl(var(--kf-accent2) / 0.15)",
              color: "hsl(var(--kf-accent2))",
              border: "1px solid hsl(var(--kf-accent2) / 0.3)"
            }}
          >
            Dashboard
          </Link>
        </div>
      </div>

      <div className={`absolute bottom-8 text-sm ${
        mounted && theme === "light" ? "text-gray-400" : "text-gray-600"
      }`}>
        Built for service businesses
      </div>
    </div>
  );
}
