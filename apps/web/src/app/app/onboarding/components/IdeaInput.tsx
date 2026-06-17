"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, Loader2, ArrowRight } from "lucide-react";

interface IdeaInputProps {
  onSubmit: (ideaText: string) => void;
  loading?: boolean;
}

const PLACEHOLDER =
  "I want to start a digital clinic management platform in Trinidad for private doctors. I have TTD 40,000 to start and want to reach TTD 50,000/month within a year.";

export function IdeaInput({ onSubmit, loading = false }: IdeaInputProps) {
  const [ideaText, setIdeaText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    const trimmed = ideaText.trim();
    if (trimmed.length < 10) {
      setError("Please share a bit more — at least 10 characters.");
      return;
    }
    setError(null);
    onSubmit(trimmed);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="space-y-5"
    >
      <div className="text-center space-y-2">
        <h2 className="text-xl sm:text-2xl font-bold">Tell KEY what you&apos;re building.</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Describe your idea, target customers, budget, and goals. The more detail you share, the
          sharper your Business Genome will be.
        </p>
      </div>

      <div className="space-y-3">
        <textarea
          value={ideaText}
          onChange={(e) => {
            setIdeaText(e.target.value);
            if (error && e.target.value.trim().length >= 10) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.metaKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          disabled={loading}
          placeholder={PLACEHOLDER}
          rows={6}
          className="w-full kf-input resize-none"
          style={{ minHeight: "160px" }}
        />
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-xs"
            style={{ color: "hsl(var(--kf-error))" }}
          >
            {error}
          </motion.p>
        )}
      </div>

      <div className="flex justify-center">
        <button
          onClick={handleSubmit}
          disabled={loading || ideaText.trim().length < 10}
          className="kf-btn-glow flex items-center gap-2 px-6 py-3"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Analyzing...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              <span>Analyze my business</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </motion.div>
  );
}
