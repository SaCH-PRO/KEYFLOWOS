"use client";

import { useState } from "react";

interface AiPreferencesPanelProps {
  preferences?: {
    autonomyLevel?: number;
    tone?: string;
    notifyOnRecommendations?: boolean;
    notifyOnAlerts?: boolean;
    voiceEnabled?: boolean;
  };
  onChange?: (prefs: Record<string, unknown>) => void;
}

export function AiPreferencesPanel({ preferences, onChange }: AiPreferencesPanelProps) {
  const [prefs, setPrefs] = useState({
    autonomyLevel: preferences?.autonomyLevel ?? 1,
    tone: preferences?.tone ?? "professional",
    notifyOnRecommendations: preferences?.notifyOnRecommendations ?? true,
    notifyOnAlerts: preferences?.notifyOnAlerts ?? true,
    voiceEnabled: preferences?.voiceEnabled ?? false,
  });

  const update = (key: string, value: unknown) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    onChange?.(next);
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium">Autonomy Level</label>
        <select
          className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
          value={prefs.autonomyLevel}
          onChange={(e) => update("autonomyLevel", parseInt(e.target.value, 10))}
        >
          <option value={0}>Read Only — Answer questions only</option>
          <option value={1}>Draft — Prepare messages and quotes</option>
          <option value={2}>Internal — Create tasks and reminders</option>
          <option value={3}>External with Approval — Send after review</option>
          <option value={4}>Trusted Autopilot — Execute low-risk workflows</option>
        </select>
      </div>
      <div>
        <label className="text-sm font-medium">Tone</label>
        <select
          className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
          value={prefs.tone}
          onChange={(e) => update("tone", e.target.value)}
        >
          <option value="professional">Professional</option>
          <option value="friendly">Friendly</option>
          <option value="direct">Direct</option>
          <option value="casual">Casual</option>
        </select>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm">Recommendations</span>
        <input
          type="checkbox"
          checked={prefs.notifyOnRecommendations}
          onChange={(e) => update("notifyOnRecommendations", e.target.checked)}
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm">Alerts</span>
        <input
          type="checkbox"
          checked={prefs.notifyOnAlerts}
          onChange={(e) => update("notifyOnAlerts", e.target.checked)}
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm">Voice Input</span>
        <input
          type="checkbox"
          checked={prefs.voiceEnabled}
          onChange={(e) => update("voiceEnabled", e.target.checked)}
        />
      </div>
    </div>
  );
}
