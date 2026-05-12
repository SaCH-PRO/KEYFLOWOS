"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShoppingCart, Send, Loader2, ArrowLeft, Sparkles, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import { createProcurementRequest } from "@/lib/client";
import { WorkspaceShell } from "@/components/ui/workspace-shell";

export default function NewProcurementPage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [priority, setPriority] = useState("NORMAL");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const biz = getStoredBusinessId();
    if (!biz || !prompt.trim()) return;
    setSubmitting(true);
    try {
      const res = await createProcurementRequest(biz, {
        userPrompt: prompt.trim(),
        priority,
      });
      if (res.data) {
        toast.success("Procurement request created");
        router.push(`/app/procurement/${res.data.id}`);
      } else {
        toast.error(res.error || "Failed to create request");
      }
    } catch {
      toast.error("Failed to create request");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <WorkspaceShell
      icon={ShoppingCart}
      title="New Procurement Request"
      subtitle="Describe what you need — KEY will interpret and recommend packages"
      iconColor="#F97316"
      headerRight={
        <button
          onClick={() => router.push("/app/procurement")}
          className="flex items-center gap-1.5 h-9 px-3 kf-radius-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-all text-xs font-medium"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </button>
      }
    >
      <div className="max-w-xl space-y-6">
        <div className="rounded-xl border border-border/50 bg-card/50 p-4 space-y-4">
          <div>
            <label className="text-xs font-medium text-foreground/80 mb-1.5 block">
              What do you need?
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. I need help setting up automated booking reminders and follow-up emails for my clients..."
              rows={4}
              className="w-full rounded-lg border border-border/50 bg-background p-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Be specific about your goals, timeline, and budget if you have one in mind.
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-foreground/80 mb-1.5 block">
              Priority
            </label>
            <div className="flex gap-2">
              {(["LOW", "NORMAL", "HIGH", "URGENT"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPriority(p)}
                  className={`flex-1 py-2 rounded-lg border text-[10px] font-medium transition-all ${
                    priority === p
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/30 bg-card/30 text-muted-foreground hover:bg-card/50"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-lg bg-amber-500/5 border border-amber-500/10 p-3">
            <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground/80">AI-powered matching:</span>{" "}
              KEY will analyze your request, check your blueprint, and recommend the best service packages for your business.
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleSubmit}
              disabled={submitting || !prompt.trim()}
              className="flex items-center gap-1.5 h-9 px-4 kf-radius-md text-xs font-medium disabled:opacity-50"
              style={{ background: "hsl(var(--kf-accent1))", color: "hsl(var(--kf-primary-foreground))" }}
            >
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Submit Request
            </button>
            <button
              onClick={() => router.push("/app/procurement")}
              className="h-9 px-4 kf-radius-md border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}
