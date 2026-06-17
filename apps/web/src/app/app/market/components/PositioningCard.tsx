"use client";

import { motion } from "framer-motion";

interface PositioningCardProps {
  positioning: {
    tagline: string;
    valueProposition: string;
    keyMessages: string[];
    differentiators: string[];
    targetSegments: string[];
  };
}

export function PositioningCard({ positioning }: PositioningCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="kf-card p-5 space-y-4"
      style={{ border: "1px solid hsl(var(--kf-border) / 0.3)" }}
    >
      <h3 className="text-sm font-semibold">Offer Positioning</h3>
      <div className="space-y-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Tagline</div>
          <p className="text-lg font-medium">{positioning.tagline || "Not set"}</p>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Value Proposition</div>
          <p className="text-sm text-muted-foreground">{positioning.valueProposition || "Not set"}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <ListSection title="Key Messages" items={positioning.keyMessages} />
          <ListSection title="Differentiators" items={positioning.differentiators} />
          <ListSection title="Target Segments" items={positioning.targetSegments} />
        </div>
      </div>
    </motion.div>
  );
}

function ListSection({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">None identified.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item, i) => (
            <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
              <span className="w-1 h-1 rounded-full mt-2 flex-shrink-0 bg-foreground/50" />
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
