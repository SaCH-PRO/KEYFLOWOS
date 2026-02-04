"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { bootstrapIdentity } from "@/lib/client";

export default function AuthCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"loading" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const hash = window.location.hash.substring(1);
        const params = new URLSearchParams(hash);
        const accessToken = params.get("access_token");
        const errorDescription = searchParams?.get("error_description");
        
        if (errorDescription) {
          throw new Error(errorDescription);
        }
        
        if (!accessToken) {
          throw new Error("No access token received");
        }

        window.localStorage.setItem("kf_token", accessToken);

        const userInfoRes = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
            },
          }
        );
        
        if (!userInfoRes.ok) {
          throw new Error("Failed to get user info");
        }
        
        const userInfo = await userInfoRes.json();
        const email = userInfo.email;
        const name = userInfo.user_metadata?.full_name || userInfo.user_metadata?.name || "";
        
        if (email) {
          window.localStorage.setItem("kf_email", email);
        }

        const bootstrap = await bootstrapIdentity({
          email,
          name,
        });
        
        if (bootstrap.data?.business?.id) {
          window.localStorage.setItem("kf_business_id", bootstrap.data.business.id);
        } else if (bootstrap.error) {
          throw new Error(bootstrap.error);
        } else {
          throw new Error("Could not create workspace. Please try again.");
        }

        router.push("/app");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Authentication failed";
        setError(message);
        setStatus("error");
      }
    };

    handleCallback();
  }, [router, searchParams]);

  if (status === "error") {
    return (
      <div className="landing">
        <h1 className="landing-title text-3xl md:text-4xl font-semibold">Authentication Error</h1>
        <div className="w-full max-w-md mx-auto bg-slate-900/40 border border-primary/30 rounded-3xl p-6 flex flex-col gap-4 text-center">
          <p className="text-amber-400 text-sm">{error}</p>
          <button
            onClick={() => router.push("/auth/login")}
            className="landing-button w-full"
          >
            Back to Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="landing">
      <h1 className="landing-title text-3xl md:text-4xl font-semibold">Signing you in...</h1>
      <div className="w-full max-w-md mx-auto bg-slate-900/40 border border-primary/30 rounded-3xl p-6 flex flex-col gap-4 text-center">
        <div className="flex items-center justify-center gap-2">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-muted-foreground">Setting up your workspace...</span>
        </div>
      </div>
    </div>
  );
}
