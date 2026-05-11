// @keyflow:dormant
"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Handshake, Send, Clock } from "lucide-react";

interface CollaborationModalProps {
  isOpen: boolean;
  onClose: () => void;
  toBusinessName: string;
  onSubmit: (data: {
    type: string;
    title: string;
    scope: string;
    proposedTerms?: string;
    timeline?: string;
  }) => Promise<void>;
}

const COLLAB_TYPES = [
  { value: "SUBCONTRACTING", label: "Subcontracting" },
  { value: "JOINT_PROJECT", label: "Joint Project" },
  { value: "RESOURCE_SHARING", label: "Resource Sharing" },
];

export function CollaborationModal({ isOpen, onClose, toBusinessName, onSubmit }: CollaborationModalProps) {
  const [type, setType] = useState("SUBCONTRACTING");
  const [title, setTitle] = useState("");
  const [scope, setScope] = useState("");
  const [proposedTerms, setProposedTerms] = useState("");
  const [timeline, setTimeline] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim() || !scope.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({
        type,
        title: title.trim(),
        scope: scope.trim(),
        proposedTerms: proposedTerms.trim() || undefined,
        timeline: timeline.trim() || undefined,
      });
      setType("SUBCONTRACTING");
      setTitle("");
      setScope("");
      setProposedTerms("");
      setTimeline("");
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed inset-x-4 top-[8%] sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 z-50 w-auto sm:w-full sm:max-w-lg"
          >
            <div className="kf-card border border-border/50 rounded-2xl overflow-hidden shadow-2xl max-h-[80vh] overflow-y-auto">
              <div className="flex items-center justify-between p-4 border-b border-border/30">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-blue-500/10">
                    <Handshake className="w-4 h-4 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">Propose Collaboration</h3>
                    <p className="text-[10px] text-muted-foreground">with {toBusinessName}</p>
                  </div>
                </div>
                <button onClick={onClose} className="p-1.5 rounded-full hover:bg-muted/50 transition-colors">
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>

              <div className="p-4 space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Collaboration Type</label>
                  <div className="flex gap-2">
                    {COLLAB_TYPES.map((ct) => (
                      <button
                        key={ct.value}
                        onClick={() => setType(ct.value)}
                        className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          type === ct.value
                            ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                            : "bg-muted/30 text-muted-foreground border border-border/30 hover:bg-muted/50"
                        }`}
                      >
                        {ct.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Title</label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Name this collaboration"
                    className="w-full px-3 py-2 rounded-lg bg-muted/30 border border-border/30 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Scope</label>
                  <textarea
                    value={scope}
                    onChange={(e) => setScope(e.target.value)}
                    placeholder="Describe the scope of work..."
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg bg-muted/30 border border-border/30 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500/50 resize-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Proposed Terms (optional)</label>
                  <textarea
                    value={proposedTerms}
                    onChange={(e) => setProposedTerms(e.target.value)}
                    placeholder="Revenue split, pricing, responsibilities..."
                    rows={2}
                    className="w-full px-3 py-2 rounded-lg bg-muted/30 border border-border/30 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500/50 resize-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Timeline (optional)
                  </label>
                  <input
                    value={timeline}
                    onChange={(e) => setTimeline(e.target.value)}
                    placeholder="e.g., 3 months, ongoing"
                    className="w-full px-3 py-2 rounded-lg bg-muted/30 border border-border/30 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                  />
                </div>
              </div>

              <div className="p-4 border-t border-border/30 flex gap-2">
                <button onClick={onClose} className="flex-1 px-4 py-2 rounded-xl bg-muted/30 text-sm font-medium hover:bg-muted/50 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={!title.trim() || !scope.trim() || submitting}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-blue-500 text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  {submitting ? "Sending..." : "Send Proposal"}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}