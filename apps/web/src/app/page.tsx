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
      <div 
        className="absolute inset-0 pointer-events-none"
        style={{
          background: mounted && theme === "light"
            ? `radial-gradient(circle at 40% 20%, hsl(var(--kf-accent1) / 0.08), transparent 45%),
               radial-gradient(circle at 70% 60%, hsl(var(--kf-accent2) / 0.06), transparent 50%)`
            : `radial-gradient(circle at 40% 20%, hsl(var(--kf-accent1) / 0.12), transparent 45%),
               radial-gradient(circle at 70% 60%, hsl(var(--kf-accent2) / 0.08), transparent 50%)`
        }}
      />

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
            style={{ 
              background: "hsl(var(--kf-accent1))",
              boxShadow: "0 4px 20px hsl(var(--kf-accent1) / 0.3)"
            }}
          >
            Get Started
          </Link>
          <Link 
            href="/app" 
            className={`px-8 py-3 rounded-xl font-semibold text-lg transition-all hover:opacity-80 ${
              mounted && theme === "light" 
                ? "border border-gray-200 text-gray-700 hover:bg-gray-50" 
                : "border border-gray-700 text-gray-300 hover:bg-gray-900"
            }`}
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
