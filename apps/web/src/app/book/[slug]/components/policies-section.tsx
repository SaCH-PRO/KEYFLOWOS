"use client";

import { useState } from "react";
import { X, FileText, ShieldCheck, Truck, ScrollText } from "lucide-react";
import type { PolicyPage } from "@/lib/client";


const policyIcons: Record<string, typeof FileText> = {
  refund: ShieldCheck,
  privacy: FileText,
  delivery: Truck,
  terms: ScrollText,
};

function PolicyModal({ policy, onClose }: { policy: PolicyPage; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-2xl max-h-[85vh] bg-white rounded-2xl overflow-hidden border border-gray-200 shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">{policy.title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:text-gray-900 hover:bg-gray-200/50 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="text-sm text-gray-500 leading-relaxed whitespace-pre-line">
            {policy.content}
          </div>
        </div>
      </div>
    </div>
  );
}

export function PoliciesFooterLinks({ policies, primaryColor: _primaryColor }: { policies: PolicyPage[]; primaryColor: string }) {
  const [activePolicy, setActivePolicy] = useState<PolicyPage | null>(null);
  const enabledPolicies = policies.filter((p) => p.enabled && p.content);

  if (enabledPolicies.length === 0) return null;

  return (
    <>
      <div className="flex items-center justify-center gap-4 flex-wrap">
        {enabledPolicies.map((policy) => {
          const Icon = policyIcons[policy.key] || FileText;
          return (
            <button
              key={policy.key}
              onClick={() => setActivePolicy(policy)}
              className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-gray-500 transition-colors min-h-[44px] px-2"
            >
              <Icon className="w-3 h-3" />
              {policy.title}
            </button>
          );
        })}
      </div>
      {activePolicy && (
        <PolicyModal policy={activePolicy} onClose={() => setActivePolicy(null)} />
      )}
    </>
  );
}
