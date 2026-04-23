"use client";

import { useState, useCallback } from "react";
import {
  Package,
  CheckCircle2,
  Truck,
  Clock,
  XCircle,
  RotateCcw,
  Loader2,
  ExternalLink,
  Copy,
  Check,
} from "lucide-react";
import { apiPost, apiGet } from "@/lib/api";

export type OrderItem = {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

export type TimelineEntry = {
  status: string;
  timestamp: string;
  note?: string;
  carrier?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  reason?: string;
  refundAmount?: number;
};

export type Order = {
  id: string;
  orderNumber: string;
  status: string;
  customerName: string;
  customerEmail?: string;
  total: number;
  currency: string;
  items: OrderItem[];
  metadata?: { statusTimeline?: TimelineEntry[] };
  shipments?: { carrier?: string; trackingNumber?: string; trackingUrl?: string }[];
};

const STATUS_STEPS = ["PENDING", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED"];
const STATUS_COLORS: Record<string, string> = {
  PENDING: "hsl(40 90% 50%)",
  CONFIRMED: "hsl(200 80% 50%)",
  PROCESSING: "hsl(270 70% 60%)",
  SHIPPED: "hsl(var(--kf-accent1))",
  DELIVERED: "hsl(var(--kf-success))",
  CANCELLED: "hsl(var(--kf-danger))",
  REFUNDED: "hsl(var(--kf-warning))",
};

const ACTIONS: Record<string, { action: string; label: string; next: string }[]> = {
  PENDING: [{ action: "confirm", label: "Confirm Order", next: "CONFIRMED" }],
  CONFIRMED: [{ action: "process", label: "Mark Processing", next: "PROCESSING" }],
  PROCESSING: [{ action: "ship", label: "Mark Shipped", next: "SHIPPED" }],
  SHIPPED: [{ action: "deliver", label: "Mark Delivered", next: "DELIVERED" }],
};

export function FulfillmentPanel({
  order,
  businessId,
  onUpdate,
}: {
  order: Order;
  businessId: string;
  onUpdate: (updated: Order) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [showTracking, setShowTracking] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [showRefund, setShowRefund] = useState(false);
  const [trackingForm, setTrackingForm] = useState({ carrier: "", trackingNumber: "", trackingUrl: "" });
  const [cancelReason, setCancelReason] = useState("");
  const [refundAmount, setRefundAmount] = useState(String(order.total));
  const [refundReason, setRefundReason] = useState("");
  const [statusToken, setStatusToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const timeline: TimelineEntry[] = order.metadata?.statusTimeline ?? [];
  const currentStepIndex = STATUS_STEPS.indexOf(order.status);

  const [actionError, setActionError] = useState<string | null>(null);

  const handleAction = useCallback(
    async (action: string, extraData?: Record<string, any>) => {
      setLoading(true);
      setActionError(null);
      const { data, error } = await apiPost<Order>({
        path: `/marketplace/businesses/${businessId}/orders/${order.id}/fulfill`,
        body: { action, ...(extraData ?? {}) },
      });
      if (data) {
        onUpdate(data);
        setShowTracking(false);
        setShowCancel(false);
        setShowRefund(false);
      } else {
        setActionError(error || "Action failed. Please try again.");
      }
      setLoading(false);
    },
    [businessId, order.id, onUpdate]
  );

  const handleGetToken = useCallback(async () => {
    const { data } = await apiGet<{ token: string }>(
      `/marketplace/businesses/${businessId}/orders/${order.id}/token`,
    );
    if (data?.token) {
      setStatusToken(data.token);
    }
  }, [businessId, order.id]);

  const copyStatusUrl = () => {
    if (!statusToken) return;
    const url = `${window.location.origin}/order/${statusToken}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isFinal = ["DELIVERED", "CANCELLED", "REFUNDED"].includes(order.status);
  const canCancel = ["PENDING", "CONFIRMED", "PROCESSING"].includes(order.status);
  const canRefund = ["DELIVERED", "CANCELLED"].includes(order.status) || order.status === "SHIPPED";

  return (
    <div className="space-y-4">
      <div
        className="rounded-xl p-4"
        style={{ background: "hsl(var(--kf-muted) / 0.1)", border: "1px solid hsl(var(--kf-border))" }}
      >
        <p className="text-xs font-medium mb-3" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
          Fulfillment Progress
        </p>
        <div className="flex items-center gap-1">
          {STATUS_STEPS.map((step, i) => {
            const isComplete = i <= currentStepIndex && !isFinal;
            const isCurrent = step === order.status;
            return (
              <div key={step} className="flex items-center gap-1 flex-1">
                <div className="flex flex-col items-center flex-1">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold transition-all"
                    style={{
                      background: isComplete
                        ? STATUS_COLORS[step] ?? "hsl(var(--kf-accent1))"
                        : "hsl(var(--kf-muted) / 0.3)",
                      color: isComplete ? "#fff" : "hsl(var(--kf-muted-foreground))",
                      border: isCurrent ? `2px solid ${STATUS_COLORS[step]}` : "none",
                    }}
                  >
                    {isComplete ? "✓" : i + 1}
                  </div>
                  <span
                    className="text-[9px] mt-1 text-center"
                    style={{
                      color: isComplete
                        ? "hsl(var(--kf-foreground))"
                        : "hsl(var(--kf-muted-foreground))",
                    }}
                  >
                    {step}
                  </span>
                </div>
                {i < STATUS_STEPS.length - 1 && (
                  <div
                    className="h-0.5 flex-1 rounded-full"
                    style={{
                      background: i < currentStepIndex
                        ? "hsl(var(--kf-accent1))"
                        : "hsl(var(--kf-muted) / 0.3)",
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {(order.status === "CANCELLED" || order.status === "REFUNDED") && (
          <div
            className="mt-3 px-3 py-2 rounded-lg text-xs font-medium"
            style={{
              background: `${STATUS_COLORS[order.status]} / 0.1)`,
              color: STATUS_COLORS[order.status],
              border: `1px solid ${STATUS_COLORS[order.status]}40`,
            }}
          >
            Order {order.status.toLowerCase()}
          </div>
        )}
      </div>

      {actionError && (
        <div className="px-3 py-2 rounded-lg text-xs font-medium" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>
          {actionError}
        </div>
      )}

      {!isFinal && (
        <div className="flex flex-wrap gap-2">
          {ACTIONS[order.status]?.map(({ action, label }) => (
            <button
              key={action}
              onClick={() => {
                if (action === "ship") {
                  setShowTracking(true);
                } else {
                  handleAction(action);
                }
              }}
              disabled={loading}
              className="kf-btn-primary min-h-[44px] px-4 text-sm flex items-center gap-1.5"
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : action === "confirm" ? (
                <CheckCircle2 className="w-3.5 h-3.5" />
              ) : action === "ship" ? (
                <Truck className="w-3.5 h-3.5" />
              ) : action === "process" ? (
                <Clock className="w-3.5 h-3.5" />
              ) : (
                <Package className="w-3.5 h-3.5" />
              )}
              {label}
            </button>
          ))}
          {canCancel && (
            <button
              onClick={() => setShowCancel(true)}
              className="kf-btn-secondary min-h-[44px] px-4 text-sm flex items-center gap-1.5"
              style={{ color: "hsl(var(--kf-danger))" }}
            >
              <XCircle className="w-3.5 h-3.5" />
              Cancel Order
            </button>
          )}
          {canRefund && (
            <button
              onClick={() => setShowRefund(true)}
              className="kf-btn-secondary min-h-[44px] px-4 text-sm flex items-center gap-1.5"
              style={{ color: "hsl(var(--kf-warning))" }}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Refund
            </button>
          )}
        </div>
      )}

      {isFinal && canRefund && order.status !== "REFUNDED" && (
        <button
          onClick={() => setShowRefund(true)}
          className="kf-btn-secondary min-h-[44px] px-4 text-sm flex items-center gap-1.5"
          style={{ color: "hsl(var(--kf-warning))" }}
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Issue Refund
        </button>
      )}

      {showTracking && (
        <div
          className="rounded-xl p-4 space-y-3"
          style={{ background: "hsl(var(--kf-muted) / 0.1)", border: "1px solid hsl(var(--kf-border))" }}
        >
          <p className="text-sm font-medium" style={{ color: "hsl(var(--kf-foreground))" }}>
            Add Tracking Information
          </p>
          {[
            { label: "Carrier", key: "carrier" as const, placeholder: "e.g., FedEx, TTPost" },
            { label: "Tracking Number", key: "trackingNumber" as const, placeholder: "Tracking number" },
            { label: "Tracking URL", key: "trackingUrl" as const, placeholder: "https://..." },
          ].map(({ label, key, placeholder }) => (
            <div key={key}>
              <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                {label}
              </label>
              <input
                type="text"
                value={trackingForm[key]}
                onChange={(e) => setTrackingForm((prev) => ({ ...prev, [key]: e.target.value }))}
                placeholder={placeholder}
                className="w-full rounded-lg px-3 py-2 text-sm min-h-[44px]"
                style={{
                  background: "hsl(var(--kf-muted) / 0.3)",
                  border: "1px solid hsl(var(--kf-border))",
                  color: "hsl(var(--kf-foreground))",
                }}
              />
            </div>
          ))}
          <div className="flex gap-2">
            <button onClick={() => setShowTracking(false)} className="kf-btn-secondary min-h-[44px] px-4 text-sm">
              Cancel
            </button>
            <button
              onClick={() => handleAction("ship", trackingForm)}
              disabled={loading}
              className="kf-btn-primary min-h-[44px] px-4 text-sm flex items-center gap-1.5"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Truck className="w-3.5 h-3.5" />}
              Ship Order
            </button>
          </div>
        </div>
      )}

      {showCancel && (
        <div
          className="rounded-xl p-4 space-y-3"
          style={{ background: "hsl(var(--kf-danger) / 0.05)", border: "1px solid hsl(var(--kf-danger) / 0.2)" }}
        >
          <p className="text-sm font-medium" style={{ color: "hsl(var(--kf-danger))" }}>
            Cancel Order
          </p>
          <textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Reason for cancellation..."
            rows={2}
            className="w-full rounded-lg px-3 py-2 text-sm resize-none"
            style={{
              background: "hsl(var(--kf-muted) / 0.3)",
              border: "1px solid hsl(var(--kf-border))",
              color: "hsl(var(--kf-foreground))",
            }}
          />
          <div className="flex gap-2">
            <button onClick={() => setShowCancel(false)} className="kf-btn-secondary min-h-[44px] px-4 text-sm">
              Keep Order
            </button>
            <button
              onClick={() => handleAction("cancel", { reason: cancelReason })}
              disabled={loading}
              className="min-h-[44px] px-4 text-sm rounded-xl font-medium flex items-center gap-1.5"
              style={{ background: "hsl(var(--kf-danger))", color: "#fff" }}
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
              Confirm Cancel
            </button>
          </div>
        </div>
      )}

      {showRefund && (
        <div
          className="rounded-xl p-4 space-y-3"
          style={{ background: "hsl(var(--kf-warning) / 0.05)", border: "1px solid hsl(var(--kf-warning) / 0.2)" }}
        >
          <p className="text-sm font-medium" style={{ color: "hsl(var(--kf-warning))" }}>
            Issue Refund
          </p>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
              Refund Amount ({order.currency})
            </label>
            <input
              type="number"
              value={refundAmount}
              onChange={(e) => setRefundAmount(e.target.value)}
              max={order.total}
              className="w-full rounded-lg px-3 py-2 text-sm min-h-[44px]"
              style={{
                background: "hsl(var(--kf-muted) / 0.3)",
                border: "1px solid hsl(var(--kf-border))",
                color: "hsl(var(--kf-foreground))",
              }}
            />
          </div>
          <textarea
            value={refundReason}
            onChange={(e) => setRefundReason(e.target.value)}
            placeholder="Reason for refund..."
            rows={2}
            className="w-full rounded-lg px-3 py-2 text-sm resize-none"
            style={{
              background: "hsl(var(--kf-muted) / 0.3)",
              border: "1px solid hsl(var(--kf-border))",
              color: "hsl(var(--kf-foreground))",
            }}
          />
          <div className="flex gap-2">
            <button onClick={() => setShowRefund(false)} className="kf-btn-secondary min-h-[44px] px-4 text-sm">
              Cancel
            </button>
            <button
              onClick={() =>
                handleAction("refund", {
                  refundAmount: parseFloat(refundAmount),
                  reason: refundReason,
                })
              }
              disabled={loading}
              className="min-h-[44px] px-4 text-sm rounded-xl font-medium flex items-center gap-1.5"
              style={{ background: "hsl(var(--kf-warning))", color: "#fff" }}
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              Process Refund
            </button>
          </div>
        </div>
      )}

      {timeline.length > 0 && (
        <div
          className="rounded-xl p-4 space-y-3"
          style={{ background: "hsl(var(--kf-muted) / 0.05)", border: "1px solid hsl(var(--kf-border))" }}
        >
          <p className="text-xs font-medium" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            Status Timeline
          </p>
          <div className="space-y-2">
            {timeline.map((entry, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className="w-2 h-2 rounded-full mt-1.5"
                    style={{ background: STATUS_COLORS[entry.status] ?? "hsl(var(--kf-accent1))" }}
                  />
                  {i < timeline.length - 1 && (
                    <div className="w-px h-6" style={{ background: "hsl(var(--kf-border))" }} />
                  )}
                </div>
                <div className="min-w-0 pb-1">
                  <p className="text-xs font-medium" style={{ color: "hsl(var(--kf-foreground))" }}>
                    {entry.status.replace(/_/g, " ")}
                  </p>
                  <p className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                    {new Date(entry.timestamp).toLocaleString()}
                  </p>
                  {entry.note && (
                    <p className="text-xs mt-0.5" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                      {entry.note}
                    </p>
                  )}
                  {entry.carrier && (
                    <p className="text-xs mt-0.5" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                      Carrier: {entry.carrier}
                      {entry.trackingNumber ? ` — ${entry.trackingNumber}` : ""}
                    </p>
                  )}
                  {entry.reason && (
                    <p className="text-xs mt-0.5" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                      Reason: {entry.reason}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div
        className="rounded-xl p-4 space-y-2"
        style={{ background: "hsl(var(--kf-muted) / 0.05)", border: "1px solid hsl(var(--kf-border))" }}
      >
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            Customer Order Status Page
          </p>
          {!statusToken && (
            <button
              onClick={handleGetToken}
              className="text-xs px-3 py-1.5 rounded-lg flex items-center gap-1"
              style={{
                background: "hsl(var(--kf-accent2) / 0.1)",
                color: "hsl(var(--kf-accent2))",
              }}
            >
              <ExternalLink className="w-3 h-3" />
              Get Link
            </button>
          )}
        </div>
        {statusToken && (
          <div className="flex items-center gap-2">
            <div
              className="flex-1 rounded-lg px-3 py-2 text-xs truncate"
              style={{
                background: "hsl(var(--kf-muted) / 0.3)",
                border: "1px solid hsl(var(--kf-border))",
                color: "hsl(var(--kf-muted-foreground))",
              }}
            >
              {window.location.origin}/order/{statusToken}
            </div>
            <button
              onClick={copyStatusUrl}
              className="kf-btn-secondary min-h-[36px] px-3 text-xs flex items-center gap-1"
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
