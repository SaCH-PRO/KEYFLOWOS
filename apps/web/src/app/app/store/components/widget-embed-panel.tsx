"use client";

import { useState, useCallback } from "react";
import { Copy, CheckCircle2, Code, Calendar, ShoppingCart, CreditCard, Monitor, Smartphone } from "lucide-react";

type WidgetType = "booking" | "cart" | "pay";

interface Props {
  slug: string;
  primaryColor?: string;
}

const WIDGET_CONFIGS: Record<WidgetType, { label: string; icon: React.ElementType; description: string; defaultHeight: number }> = {
  booking: { label: "Booking Widget", icon: Calendar, description: "Let customers book appointments directly on your website.", defaultHeight: 600 },
  cart: { label: "Product Cart", icon: ShoppingCart, description: "Sell products with an embedded shopping cart.", defaultHeight: 700 },
  pay: { label: "Payment Link", icon: CreditCard, description: "Embed a quick payment form for any amount.", defaultHeight: 500 },
};

export function WidgetEmbedPanel({ slug, primaryColor = "#f97316" }: Props) {
  const [widgetType, setWidgetType] = useState<WidgetType>("booking");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [color, setColor] = useState(primaryColor);
  const [copied, setCopied] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);

  const domain = typeof window !== "undefined" ? window.location.origin : "";
  const widgetUrl = `${domain}/widgets/${widgetType}/${slug}?theme=${theme}&primary=${encodeURIComponent(color)}`;

  const iframeCode = `<iframe
  src="${widgetUrl}"
  width="100%"
  height="${WIDGET_CONFIGS[widgetType].defaultHeight}"
  frameborder="0"
  style="border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.08);"
  title="${WIDGET_CONFIGS[widgetType].label}"
></iframe>
<script>
  window.addEventListener('message', (e) => {
    if (e.data?.type === 'KEYFLOW_WIDGET_RESIZE') {
      const iframe = document.querySelector('iframe[src="${widgetUrl}"]');
      if (iframe) iframe.style.height = e.data.height + 'px';
    }
  });
</script>`;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(iframeCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [iframeCode]);

  const handlePreview = useCallback(() => {
    setPreviewKey((k) => k + 1);
  }, []);

  const config = WIDGET_CONFIGS[widgetType];
  const Icon = config.icon;

  return (
    <div className="space-y-5">
      {/* Widget type selector */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {(Object.entries(WIDGET_CONFIGS) as [WidgetType, typeof config][]).map(([type, cfg]) => {
          const TypeIcon = cfg.icon;
          return (
            <button
              key={type}
              onClick={() => setWidgetType(type)}
              className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                widgetType === type
                  ? "border-[hsl(24_95%_53%/0.4)] bg-[hsl(24_95%_53%/0.08)]"
                  : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]"
              }`}
            >
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                widgetType === type ? "bg-[hsl(24_95%_53%/0.15)]" : "bg-white/[0.04]"
              }`}>
                <TypeIcon className={`w-4 h-4 ${widgetType === type ? "text-[hsl(24_95%_63%)]" : "text-[hsl(30_10%_45%)]"}`} />
              </div>
              <div>
                <p className={`text-sm font-medium ${widgetType === type ? "text-[hsl(30_20%_98%)]" : "text-[hsl(30_10%_55%)]"}`}>
                  {cfg.label}
                </p>
                <p className="text-[10px] text-[hsl(30_10%_40%)] leading-tight">{cfg.description}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Customization */}
      <div className="flex flex-wrap items-center gap-4 p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[hsl(30_10%_45%)]">Theme</span>
          <div className="flex rounded-lg border border-white/[0.08] overflow-hidden">
            <button
              onClick={() => setTheme("dark")}
              className={`px-3 py-1.5 text-xs font-medium transition-all ${
                theme === "dark" ? "bg-[hsl(24_95%_53%)] text-white" : "bg-white/[0.03] text-[hsl(30_10%_45%)] hover:text-[hsl(30_20%_85%)]"
              }`}
            >
              <Monitor className="w-3.5 h-3.5 inline mr-1" />
              Dark
            </button>
            <button
              onClick={() => setTheme("light")}
              className={`px-3 py-1.5 text-xs font-medium transition-all ${
                theme === "light" ? "bg-[hsl(24_95%_53%)] text-white" : "bg-white/[0.03] text-[hsl(30_10%_45%)] hover:text-[hsl(30_20%_85%)]"
              }`}
            >
              <Smartphone className="w-3.5 h-3.5 inline mr-1" />
              Light
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-[hsl(30_10%_45%)]">Accent</span>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="w-8 h-8 rounded-lg border border-white/[0.08] bg-transparent cursor-pointer"
          />
          <span className="text-xs font-mono text-[hsl(30_10%_45%)]">{color}</span>
        </div>

        <button
          onClick={handlePreview}
          className="ml-auto text-xs text-[hsl(24_95%_53%)] hover:text-[hsl(24_95%_63%)] transition-colors"
        >
          Refresh Preview
        </button>
      </div>

      {/* Live preview */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center gap-2">
          <Icon className="w-3.5 h-3.5 text-[hsl(24_95%_53%)]" />
          <span className="text-xs font-medium text-[hsl(30_10%_55%)]">Live Preview</span>
        </div>
        <div className="p-4">
          <iframe
            key={previewKey}
            src={widgetUrl}
            width="100%"
            height={config.defaultHeight}
            frameBorder="0"
            className="rounded-xl"
            style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}
            title={config.label}
          />
        </div>
      </div>

      {/* Embed code */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Code className="w-3.5 h-3.5 text-[hsl(24_95%_53%)]" />
            <span className="text-xs font-medium text-[hsl(30_10%_55%)]">Embed Code</span>
          </div>
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all bg-white/[0.04] border border-white/[0.08] text-[hsl(30_10%_55%)] hover:text-[hsl(30_20%_85%)] hover:bg-white/[0.07]"
          >
            {copied ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <pre className="p-4 text-[11px] font-mono text-[hsl(30_10%_55%)] overflow-x-auto whitespace-pre-wrap break-all">
          {iframeCode}
        </pre>
      </div>
    </div>
  );
}
