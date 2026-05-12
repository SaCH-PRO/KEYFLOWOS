"use client";

import { useState } from "react";
import { Clock, ChevronDown, ChevronUp, Tag } from "lucide-react";

interface ChangelogEntry {
  id: string;
  version: string;
  date: string;
  changes: string[];
}

interface Props {
  entries?: ChangelogEntry[];
}

export function PublishChangelog({ entries = [] }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (entries.length === 0) {
    return (
      <div className="text-xs text-muted-foreground text-center py-2">
        No publish history yet. Changes will be tracked after your first publish.
      </div>
    );
  }

  const latest = entries[0];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tag className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">{latest.version}</span>
          <span className="text-[10px] text-muted-foreground">{latest.date}</span>
        </div>
        {entries.length > 1 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? "Less" : `+${entries.length - 1} more`}
          </button>
        )}
      </div>
      <ul className="space-y-1">
        {latest.changes.map((change, i) => (
          <li key={i} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
            <span className="text-primary mt-0.5">•</span>
            {change}
          </li>
        ))}
      </ul>

      {expanded && entries.slice(1).map((entry) => (
        <div key={entry.id} className="pt-2 border-t border-border/20">
          <div className="flex items-center gap-2 mb-1">
            <Tag className="w-3 h-3 text-muted-foreground/50" />
            <span className="text-[11px] font-medium">{entry.version}</span>
            <span className="text-[10px] text-muted-foreground/50">{entry.date}</span>
          </div>
          <ul className="space-y-1">
            {entry.changes.map((change, i) => (
              <li key={i} className="text-[10px] text-muted-foreground/70 flex items-start gap-1.5">
                <span className="text-muted-foreground/40 mt-0.5">•</span>
                {change}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
