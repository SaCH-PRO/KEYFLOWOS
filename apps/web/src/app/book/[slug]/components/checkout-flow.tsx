"use client";

import { useState, useEffect } from "react";
import {
  Calendar,
  Clock,
  User,
  CheckCircle2,
  Loader2,
  ArrowLeft,
  Plus,
  Minus,
  AlertTriangle,
} from "lucide-react";
import { formatPrice } from "@/lib/format";
import type { CartItem, Staff, Business, ServiceBookingData } from "./types";
import { getAvailableSlots, isDayClosed, typeBadge } from "./utils";

type Props = {
  business: Business;
  cart: CartItem[];
  staff: Staff[];
  primaryColor: string;
  secondaryColor: string;
  cartTotal: number;
  cartCurrency: string;
  onBack: () => void;
  onUpdateQuantity: (itemId: string, itemType: string, delta: number) => void;
  onSubmit: (data: {
    serviceBookings: Record<string, ServiceBookingData>;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  }) => Promise<void>;
};

export function CheckoutFlow({
  business,
  cart,
  staff,
  primaryColor,
  secondaryColor,
  cartTotal,
  cartCurrency,
  onBack,
  onUpdateQuantity,
  onSubmit,
}: Props) {
  const [checkoutStep, setCheckoutStep] = useState(0);
  const [serviceBookings, setServiceBookings] = useState<Record<string, ServiceBookingData>>({});
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const serviceItemsInCart = cart.filter((c) => c.requiresBooking);

  const checkoutSteps = (() => {
    const steps = [{ key: "review", label: "Review Cart" }];
    if (serviceItemsInCart.length > 0) steps.push({ key: "booking", label: "Schedule" });
    steps.push({ key: "details", label: "Your Details" });
    steps.push({ key: "confirm", label: "Confirm" });
    return steps;
  })();

  useEffect(() => {
    if (checkoutStep >= checkoutSteps.length) {
      setCheckoutStep(Math.max(0, checkoutSteps.length - 1));
    }
  }, [checkoutSteps.length, checkoutStep]);

  const canProceedStep = (() => {
    const stepKey = checkoutSteps[checkoutStep]?.key;
    if (stepKey === "review") return cart.length > 0;
    if (stepKey === "booking") {
      return serviceItemsInCart.every((si) => {
        const bd = serviceBookings[`${si.id}_${si.itemType}`];
        return bd && bd.date && bd.time;
      });
    }
    if (stepKey === "details") return firstName.trim() !== "" && emailInput.trim() !== "";
    return true;
  })();

  const handleSubmitBooking = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        serviceBookings,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: emailInput.trim(),
        phone: phoneInput.trim(),
      });
    } catch (e: any) {
      setError(e?.message || "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  };

  const currentStepKey = checkoutSteps[checkoutStep]?.key;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <button
        onClick={() => {
          if (checkoutStep === 0) onBack();
          else setCheckoutStep((s) => s - 1);
        }}
        className="flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        {checkoutStep === 0 ? "Back to Shop" : "Previous Step"}
      </button>

      <div className="flex items-center gap-2 mb-6">
        {checkoutSteps.map((step, idx) => (
          <div key={step.key} className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                idx < checkoutStep
                  ? "text-white"
                  : idx === checkoutStep
                  ? "text-white ring-2"
                  : "bg-white/5 text-white/30"
              }`}
              style={
                idx < checkoutStep
                  ? { backgroundColor: primaryColor }
                  : idx === checkoutStep
                  ? { backgroundColor: `${primaryColor}30`, ringColor: primaryColor }
                  : {}
              }
            >
              {idx < checkoutStep ? <CheckCircle2 className="w-4 h-4" /> : idx + 1}
            </div>
            <span
              className={`text-xs hidden sm:inline ${
                idx === checkoutStep ? "text-white font-medium" : "text-white/30"
              }`}
            >
              {step.label}
            </span>
            {idx < checkoutSteps.length - 1 && (
              <div
                className="w-8 h-px"
                style={{ backgroundColor: idx < checkoutStep ? primaryColor : "rgba(255,255,255,0.1)" }}
              />
            )}
          </div>
        ))}
      </div>

      {currentStepKey === "review" && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Review Your Cart</h2>
          {cart.map((item) => {
            const badge = typeBadge(item.itemType, primaryColor, secondaryColor);
            return (
              <div
                key={`${item.id}_${item.itemType}`}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 flex items-center gap-4"
              >
                {item.imageUrl && (
                  <img src={item.imageUrl} alt={item.name} className="w-16 h-16 rounded-xl object-cover flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold"
                      style={{ backgroundColor: `${badge.color}20`, color: badge.color }}
                    >
                      {badge.label}
                    </span>
                    {item.requiresBooking && (
                      <span className="text-[10px] text-amber-400 flex items-center gap-0.5">
                        <AlertTriangle className="w-3 h-3" /> Needs booking
                      </span>
                    )}
                  </div>
                  <h4 className="font-medium text-sm truncate">{item.name}</h4>
                  <p className="text-xs text-white/40">
                    {formatPrice(item.price, item.currency)}
                    {item.duration ? ` \u00b7 ${item.duration} min` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onUpdateQuantity(item.id, item.itemType, -1)}
                    className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="text-sm font-medium w-6 text-center">{item.quantity}</span>
                  <button
                    onClick={() => onUpdateQuantity(item.id, item.itemType, 1)}
                    className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
                <div className="text-sm font-semibold whitespace-nowrap" style={{ color: primaryColor }}>
                  {formatPrice(item.price * item.quantity, item.currency)}
                </div>
              </div>
            );
          })}
          <div
            className="rounded-2xl border p-4 flex justify-between items-center"
            style={{ borderColor: `${primaryColor}30`, backgroundColor: `${primaryColor}08` }}
          >
            <span className="font-medium">Subtotal</span>
            <span className="text-lg font-bold" style={{ color: primaryColor }}>
              {formatPrice(cartTotal, cartCurrency)}
            </span>
          </div>
        </div>
      )}

      {currentStepKey === "booking" && (
        <div className="space-y-6">
          <h2 className="text-xl font-semibold">Schedule Your Services</h2>
          {serviceItemsInCart.map((si) => {
            const key = `${si.id}_${si.itemType}`;
            const bd = serviceBookings[key] || {
              serviceId: si.sourceServiceId || si.id,
              serviceName: si.name,
              staffId: "",
              date: "",
              time: "",
            };
            const slots = getAvailableSlots(bd.date, business.businessHours);
            const closed = isDayClosed(bd.date, business.businessHours);
            const updateBd = (patch: Partial<ServiceBookingData>) => {
              setServiceBookings((prev) => ({ ...prev, [key]: { ...bd, ...patch } }));
            };

            return (
              <div key={key} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold"
                    style={{ backgroundColor: `${primaryColor}20`, color: primaryColor }}
                  >
                    {"\u{1F6E0}"} Service
                  </span>
                  <h3 className="font-medium">{si.name}</h3>
                  {si.quantity > 1 && <span className="text-xs text-white/40">x{si.quantity}</span>}
                </div>

                {staff.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-wider text-white/40 flex items-center gap-2">
                      <User className="w-3 h-3" /> Staff (Optional)
                    </label>
                    <div className="flex gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => updateBd({ staffId: "" })}
                        className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-all ${
                          !bd.staffId ? "border-white/20 bg-white/10" : "border-white/10 hover:border-white/20 bg-white/[0.02]"
                        }`}
                      >
                        <User className="w-3.5 h-3.5 text-white/40" /> Any
                      </button>
                      {staff.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => updateBd({ staffId: s.id })}
                          className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-all ${
                            bd.staffId === s.id ? "border-white/20 bg-white/10" : "border-white/10 hover:border-white/20 bg-white/[0.02]"
                          }`}
                        >
                          <div
                            className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold"
                            style={{ backgroundColor: `${secondaryColor}20`, color: secondaryColor }}
                          >
                            {s.name.charAt(0).toUpperCase()}
                          </div>
                          {s.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-wider text-white/40 flex items-center gap-2">
                    <Calendar className="w-3 h-3" /> Date
                  </label>
                  <input
                    type="date"
                    value={bd.date}
                    onChange={(e) => updateBd({ date: e.target.value, time: "" })}
                    min={new Date().toISOString().split("T")[0]}
                    className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 transition-all"
                  />
                </div>

                {bd.date && closed && (
                  <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300">
                    Closed on{" "}
                    {new Date(bd.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" })}
                    s. Please pick another date.
                  </div>
                )}

                {bd.date && !closed && slots.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-wider text-white/40 flex items-center gap-2">
                      <Clock className="w-3 h-3" /> Time
                    </label>
                    <div
                      className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-[180px] overflow-y-auto"
                      style={{ scrollbarWidth: "thin" }}
                    >
                      {slots.map((slot) => (
                        <button
                          key={slot}
                          type="button"
                          onClick={() => updateBd({ time: slot })}
                          className={`px-2 py-2 rounded-lg text-xs font-medium border transition-all ${
                            bd.time === slot
                              ? "text-white border-transparent"
                              : "border-white/10 bg-white/[0.03] text-white/60 hover:border-white/20 hover:text-white"
                          }`}
                          style={
                            bd.time === slot
                              ? { backgroundColor: primaryColor, borderColor: primaryColor }
                              : {}
                          }
                        >
                          {slot}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {bd.date && !closed && slots.length === 0 && (
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/40">
                    No time slots available for this date.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {currentStepKey === "details" && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Your Details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First Name *"
              className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:ring-2 transition-all"
            />
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last Name"
              className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:ring-2 transition-all"
            />
            <input
              type="email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="Email *"
              className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:ring-2 transition-all"
            />
            <input
              type="tel"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              placeholder="Phone (optional)"
              className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:ring-2 transition-all"
            />
          </div>
        </div>
      )}

      {currentStepKey === "confirm" && (
        <div className="space-y-5">
          <h2 className="text-xl font-semibold">Confirm Your Order</h2>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-3">
            <div className="text-xs uppercase tracking-wider text-white/40">Items</div>
            {cart.map((item) => (
              <div key={`${item.id}_${item.itemType}`} className="flex justify-between text-sm">
                <span className="text-white/60">{item.name} x{item.quantity}</span>
                <span className="text-white font-medium">{formatPrice(item.price * item.quantity, item.currency)}</span>
              </div>
            ))}
            <div className="border-t border-white/10 pt-3 flex justify-between text-base font-semibold">
              <span style={{ color: primaryColor }}>Total</span>
              <span style={{ color: primaryColor }}>{formatPrice(cartTotal, cartCurrency)}</span>
            </div>
          </div>

          {serviceItemsInCart.length > 0 && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-3">
              <div className="text-xs uppercase tracking-wider text-white/40">Appointments</div>
              {serviceItemsInCart.map((si) => {
                const bd = serviceBookings[`${si.id}_${si.itemType}`];
                if (!bd) return null;
                const staffMember = staff.find((s) => s.id === bd.staffId);
                return (
                  <div key={`${si.id}_${si.itemType}`} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-white/60">{si.name}</span>
                      <span className="text-white">
                        {bd.date &&
                          new Date(`${bd.date}T${bd.time || "00:00"}`).toLocaleDateString("en-US", {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          })}{" "}
                        at {bd.time}
                      </span>
                    </div>
                    {staffMember && <div className="text-xs text-white/40">Staff: {staffMember.name}</div>}
                  </div>
                );
              })}
            </div>
          )}

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-2">
            <div className="text-xs uppercase tracking-wider text-white/40">Contact</div>
            <div className="text-sm text-white">{firstName} {lastName}</div>
            <div className="text-sm text-white/60">{emailInput}</div>
            {phoneInput && <div className="text-sm text-white/60">{phoneInput}</div>}
          </div>

          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-3 pt-4">
        {checkoutStep > 0 && (
          <button
            onClick={() => setCheckoutStep((s) => s - 1)}
            className="flex-1 py-3 rounded-xl border border-white/10 text-sm font-medium hover:bg-white/5 transition-all"
          >
            Back
          </button>
        )}
        {checkoutStep < checkoutSteps.length - 1 ? (
          <button
            onClick={() => setCheckoutStep((s) => s + 1)}
            disabled={!canProceedStep}
            className="flex-1 py-3 rounded-xl text-white text-sm font-semibold transition-all hover:scale-[1.01] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
            style={{ backgroundColor: primaryColor }}
          >
            Continue
          </button>
        ) : (
          <button
            onClick={handleSubmitBooking}
            disabled={submitting || !canProceedStep}
            className="flex-1 py-3.5 rounded-xl text-white font-semibold text-sm transition-all hover:scale-[1.01] hover:shadow-lg disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
            style={{ backgroundColor: primaryColor, boxShadow: `0 8px 32px ${primaryColor}30` }}
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Processing...
              </span>
            ) : serviceItemsInCart.length > 0 ? (
              "Confirm Booking"
            ) : (
              "Place Order"
            )}
          </button>
        )}
      </div>
    </div>
  );
}
