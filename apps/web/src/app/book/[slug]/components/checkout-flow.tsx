"use client";

import { useState, useEffect } from "react";
import {
  Calendar,
  Clock,
  User,
  CheckCircle2,
  Loader2,
  ArrowLeft,
  ArrowRight,
  Plus,
  Minus,
  AlertTriangle,
  ShoppingBag,
  CalendarDays,
  UserCircle,
  ClipboardCheck,
  ShieldCheck,
  Lock,
  Package,
  CreditCard,
  Truck,
  MapPin,
  MessageCircle,
  ChevronDown,
  ChevronUp,
  Award,
} from "lucide-react";
import { formatPrice } from "@/lib/format";
import type {
  CartItem,
  Staff,
  Business,
  ServiceBookingData,
  PromoCode,
  DeliveryAddress,
  PaymentMethod,
  ShippingZone,
} from "./types";
import {
  getAvailableSlots,
  isDayClosed,
  typeBadge,
  calculateDiscount,
  loadCheckoutDetails,
  saveCheckoutDetails,
} from "./utils";

type Props = {
  business: Business;
  cart: CartItem[];
  staff: Staff[];
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  cartTotal: number;
  cartCurrency: string;
  promoCode: PromoCode | null;
  shippingZones: ShippingZone[];
  taxRate?: number;
  onBack: () => void;
  onUpdateQuantity: (itemId: string, itemType: string, delta: number) => void;
  onSubmit: (data: {
    serviceBookings: Record<string, ServiceBookingData>;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    paymentMethod: PaymentMethod;
    deliveryAddress: DeliveryAddress | null;
    shippingZoneId: string | null;
    termsAccepted: boolean;
  }) => Promise<void>;
};

const paymentMethods: { id: PaymentMethod; name: string; description: string; icon: typeof CreditCard }[] = [
  { id: "wipay", name: "WiPay", description: "Pay with credit/debit card via WiPay", icon: CreditCard },
  { id: "paypal", name: "PayPal", description: "Pay securely with your PayPal account", icon: CreditCard },
  { id: "cash", name: "Cash / Manual Payment", description: "Pay in person or arrange payment with the business", icon: CreditCard },
];

export function CheckoutFlow({
  business,
  cart,
  staff,
  primaryColor,
  secondaryColor,
  accentColor,
  cartTotal,
  cartCurrency,
  promoCode,
  shippingZones,
  taxRate,
  onBack,
  onUpdateQuantity,
  onSubmit,
}: Props) {
  const [checkoutStep, setCheckoutStep] = useState(0);
  const [serviceBookings, setServiceBookings] = useState<Record<string, ServiceBookingData>>({});

  const savedDetails = loadCheckoutDetails();
  const [firstName, setFirstName] = useState(savedDetails.firstName);
  const [lastName, setLastName] = useState(savedDetails.lastName);
  const [emailInput, setEmailInput] = useState(savedDetails.email);
  const [phoneInput, setPhoneInput] = useState(savedDetails.phone);

  const [deliveryAddress, setDeliveryAddress] = useState<DeliveryAddress>({
    street: "",
    city: "",
    state: "",
    postalCode: "",
    country: "",
  });

  const [selectedShippingZone, setSelectedShippingZone] = useState<string | null>(null);
  const [selectedPayment, setSelectedPayment] = useState<PaymentMethod>("wipay");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showRefundPolicy, setShowRefundPolicy] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepDirection, setStepDirection] = useState<"forward" | "back">("forward");
  const [fieldTouched, setFieldTouched] = useState<Record<string, boolean>>({});

  const serviceItemsInCart = cart.filter((c) => c.requiresBooking);
  const hasPhysicalProducts = cart.some((c) => c.itemType === "product");
  const hasServicesOnly = serviceItemsInCart.length > 0 && !hasPhysicalProducts;

  const checkoutSteps = (() => {
    const steps: { key: string; label: string }[] = [{ key: "info", label: "Information" }];
    if (serviceItemsInCart.length > 0 || hasPhysicalProducts) {
      steps.push({ key: "delivery", label: hasServicesOnly ? "Schedule" : "Delivery" });
    }
    steps.push({ key: "payment", label: "Payment" });
    return steps;
  })();

  useEffect(() => {
    if (checkoutStep >= checkoutSteps.length) {
      setCheckoutStep(Math.max(0, checkoutSteps.length - 1));
    }
  }, [checkoutSteps.length, checkoutStep]);

  const discount = calculateDiscount(cartTotal, promoCode);
  const effectiveTaxRate = taxRate ?? 0;
  const estimatedTax = effectiveTaxRate > 0 ? Math.round(cartTotal * (effectiveTaxRate / 100) * 100) / 100 : 0;
  const activeZone = shippingZones.find((z) => z.id === selectedShippingZone);
  const shippingFee = (() => {
    if (!hasPhysicalProducts || !activeZone) return 0;
    if (activeZone.freeAbove !== null && cartTotal >= activeZone.freeAbove) return 0;
    return activeZone.baseFee;
  })();
  const orderTotal = cartTotal - discount + estimatedTax + shippingFee;

  const canProceedStep = (() => {
    const stepKey = checkoutSteps[checkoutStep]?.key;
    if (stepKey === "info") {
      const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.trim());
      return firstName.trim() !== "" && emailValid;
    }
    if (stepKey === "delivery") {
      if (serviceItemsInCart.length > 0) {
        const allBooked = serviceItemsInCart.every((si) => {
          const bd = serviceBookings[`${si.id}_${si.itemType}`];
          return bd && bd.date && bd.time;
        });
        if (!allBooked) return false;
      }
      if (hasPhysicalProducts) {
        const addressValid = deliveryAddress.street.trim() !== "" && deliveryAddress.city.trim() !== "";
        const shippingValid = shippingZones.length === 0 || selectedShippingZone !== null;
        return addressValid && shippingValid;
      }
      return true;
    }
    if (stepKey === "payment") {
      return termsAccepted;
    }
    return true;
  })();

  const handleSubmitOrder = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        serviceBookings,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: emailInput.trim(),
        phone: phoneInput.trim(),
        paymentMethod: selectedPayment,
        deliveryAddress: hasPhysicalProducts ? deliveryAddress : null,
        shippingZoneId: selectedShippingZone,
        termsAccepted,
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  };

  const goNext = () => {
    setStepDirection("forward");
    const currentKey = checkoutSteps[checkoutStep]?.key;
    if (currentKey === "info") {
      saveCheckoutDetails({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: emailInput.trim(),
        phone: phoneInput.trim(),
      });
    }
    setCheckoutStep((s) => s + 1);
  };

  const goBack = () => {
    setStepDirection("back");
    if (checkoutStep === 0) onBack();
    else setCheckoutStep((s) => s - 1);
  };

  const currentStepKey = checkoutSteps[checkoutStep]?.key;

  const serviceItems = cart.filter((c) => c.itemType === "service");
  const productItems = cart.filter((c) => c.itemType !== "service");

  return (
    <div className="min-h-screen relative">
      <div
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          background: `radial-gradient(ellipse at top center, ${primaryColor}12 0%, transparent 50%)`,
        }}
      />

      <div className="relative max-w-2xl mx-auto px-4 py-8 space-y-6">
        <button
          onClick={goBack}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-700 transition-all duration-200 group"
        >
          <ArrowLeft className="w-4 h-4 transition-transform duration-200 group-hover:-translate-x-1" />
          {checkoutStep === 0 ? "Back to Shop" : "Previous Step"}
        </button>

        <div className="relative">
          <div className="absolute top-4 left-0 right-0 h-[2px] bg-gray-50 mx-12 sm:mx-16" />
          <div
            className="absolute top-4 left-0 h-[2px] mx-12 sm:mx-16 transition-all duration-500 ease-out rounded-full"
            style={{
              backgroundColor: primaryColor,
              width: `${(checkoutStep / (checkoutSteps.length - 1)) * 100}%`,
              maxWidth: "calc(100% - 6rem)",
              boxShadow: `0 0 8px ${primaryColor}40`,
            }}
          />

          <div className="relative flex justify-between">
            {checkoutSteps.map((step, idx) => {
              const isComplete = idx < checkoutStep;
              const isCurrent = idx === checkoutStep;

              return (
                <div key={step.key} className="flex flex-col items-center gap-2 z-10">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300"
                    style={{
                      backgroundColor: isComplete
                        ? primaryColor
                        : isCurrent
                        ? `${primaryColor}20`
                        : "rgba(0,0,0,0.03)",
                      border: isCurrent ? `2px solid ${primaryColor}` : "2px solid transparent",
                      boxShadow: isComplete ? `0 0 12px ${primaryColor}30` : isCurrent ? `0 0 16px ${primaryColor}20` : "none",
                      color: isComplete ? "#fff" : isCurrent ? primaryColor : "rgba(0,0,0,0.08)",
                      transform: isCurrent ? "scale(1.1)" : "scale(1)",
                    }}
                  >
                    {isComplete ? <CheckCircle2 className="w-4 h-4" /> : <span>{idx + 1}</span>}
                  </div>
                  <span
                    className="text-[10px] sm:text-xs font-medium transition-all duration-300"
                    style={{
                      color: isCurrent ? "rgba(0,0,0,0.8)" : isComplete ? primaryColor : "rgba(0,0,0,0.15)",
                    }}
                  >
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {currentStepKey !== "payment" && (
          <div
            className="rounded-2xl border border-gray-200 p-4 flex items-center justify-between"
            style={{ background: "linear-gradient(135deg, rgba(0,0,0,0.03) 0%, rgba(0,0,0,0.01) 100%)" }}
          >
            <div className="flex items-center gap-3">
              <ShoppingBag className="w-4 h-4 text-gray-400" />
              <div>
                <span className="text-xs text-gray-500">
                  {cart.reduce((s, c) => s + c.quantity, 0)} {cart.reduce((s, c) => s + c.quantity, 0) === 1 ? "item" : "items"}
                </span>
                <span className="text-xs text-gray-900/25 mx-2">·</span>
                <span className="text-xs text-gray-400">Subtotal</span>
              </div>
            </div>
            <div className="text-right">
              <span className="text-sm font-bold tabular-nums" style={{ color: primaryColor }}>
                {formatPrice(orderTotal, cartCurrency)}
              </span>
              {estimatedTax > 0 && (
                <p className="text-[9px] text-gray-900/25">incl. {effectiveTaxRate}% tax</p>
              )}
            </div>
          </div>
        )}

        <div
          key={currentStepKey}
          style={{
            animation: `${stepDirection === "forward" ? "stepForward" : "stepBack"} 350ms cubic-bezier(0.16,1,0.3,1)`,
          }}
        >
          {currentStepKey === "info" && (
            <div className="space-y-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${primaryColor}12` }}>
                  <UserCircle className="w-5 h-5" style={{ color: primaryColor }} />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">Your Information</h2>
                  <p className="text-xs text-gray-400">No account needed — just your contact details</p>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 p-5 space-y-4" style={{ background: "linear-gradient(135deg, rgba(0,0,0,0.03) 0%, rgba(0,0,0,0.01) 100%)" }}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase tracking-widest text-gray-400 font-medium">
                      First Name <span style={{ color: primaryColor }}>*</span>
                    </label>
                    <input
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      onBlur={() => setFieldTouched((p) => ({ ...p, firstName: true }))}
                      placeholder="John"
                      autoComplete="given-name"
                      className="w-full rounded-xl border border-gray-200 bg-white/[0.02] px-4 py-3 text-sm text-gray-900 placeholder:text-gray-300 focus:outline-none transition-all duration-200"
                      style={{ borderColor: firstName.trim() ? `${primaryColor}25` : fieldTouched.firstName && !firstName.trim() ? "rgba(239,68,68,0.4)" : undefined }}
                    />
                    {fieldTouched.firstName && !firstName.trim() && (
                      <p className="text-[10px] text-red-400/80 mt-0.5">First name is required</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase tracking-widest text-gray-400 font-medium">
                      Last Name
                    </label>
                    <input
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Doe"
                      autoComplete="family-name"
                      className="w-full rounded-xl border border-gray-200 bg-white/[0.02] px-4 py-3 text-sm text-gray-900 placeholder:text-gray-300 focus:outline-none transition-all duration-200"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase tracking-widest text-gray-400 font-medium">
                      Email <span style={{ color: primaryColor }}>*</span>
                    </label>
                    <input
                      type="email"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      onBlur={() => setFieldTouched((p) => ({ ...p, email: true }))}
                      placeholder="john@example.com"
                      autoComplete="email"
                      className="w-full rounded-xl border border-gray-200 bg-white/[0.02] px-4 py-3 text-sm text-gray-900 placeholder:text-gray-300 focus:outline-none transition-all duration-200"
                      style={{ borderColor: emailInput.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput) ? `${primaryColor}25` : fieldTouched.email && (!emailInput.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput)) ? "rgba(239,68,68,0.4)" : undefined }}
                    />
                    {fieldTouched.email && !emailInput.trim() && (
                      <p className="text-[10px] text-red-400/80 mt-0.5">Email is required</p>
                    )}
                    {fieldTouched.email && emailInput.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput) && (
                      <p className="text-[10px] text-red-400/80 mt-0.5">Please enter a valid email address</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase tracking-widest text-gray-400 font-medium">
                      Phone
                    </label>
                    <input
                      type="tel"
                      value={phoneInput}
                      onChange={(e) => setPhoneInput(e.target.value)}
                      placeholder="+1 (555) 000-0000"
                      autoComplete="tel"
                      className="w-full rounded-xl border border-gray-200 bg-white/[0.02] px-4 py-3 text-sm text-gray-900 placeholder:text-gray-300 focus:outline-none transition-all duration-200"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 text-[10px] text-gray-900/25 pt-1">
                  <Lock className="w-3 h-3" />
                  <span>Your information is kept private and secure</span>
                </div>
              </div>
            </div>
          )}

          {currentStepKey === "delivery" && (
            <div className="space-y-6">
              {hasPhysicalProducts && (
                <>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${primaryColor}12` }}>
                      <Truck className="w-5 h-5" style={{ color: primaryColor }} />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold text-gray-900">Delivery Address</h2>
                      <p className="text-xs text-gray-400">Where should we deliver your products?</p>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-gray-200 p-5 space-y-3" style={{ background: "linear-gradient(135deg, rgba(0,0,0,0.03) 0%, rgba(0,0,0,0.01) 100%)" }}>
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase tracking-widest text-gray-400 font-medium">
                        Street Address <span style={{ color: primaryColor }}>*</span>
                      </label>
                      <input
                        type="text"
                        value={deliveryAddress.street}
                        onChange={(e) => setDeliveryAddress((a) => ({ ...a, street: e.target.value }))}
                        placeholder="123 Main Street"
                        autoComplete="street-address"
                        className="w-full rounded-xl border border-gray-200 bg-white/[0.02] px-4 py-3 text-sm text-gray-900 placeholder:text-gray-300 focus:outline-none transition-all duration-200"
                        style={{ borderColor: deliveryAddress.street.trim() ? `${primaryColor}25` : undefined }}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase tracking-widest text-gray-400 font-medium">
                          City <span style={{ color: primaryColor }}>*</span>
                        </label>
                        <input
                          type="text"
                          value={deliveryAddress.city}
                          onChange={(e) => setDeliveryAddress((a) => ({ ...a, city: e.target.value }))}
                          placeholder="Port of Spain"
                          autoComplete="address-level2"
                          className="w-full rounded-xl border border-gray-200 bg-white/[0.02] px-4 py-3 text-sm text-gray-900 placeholder:text-gray-300 focus:outline-none transition-all duration-200"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase tracking-widest text-gray-400 font-medium">
                          State / Region
                        </label>
                        <input
                          type="text"
                          value={deliveryAddress.state}
                          onChange={(e) => setDeliveryAddress((a) => ({ ...a, state: e.target.value }))}
                          placeholder="Region"
                          autoComplete="address-level1"
                          className="w-full rounded-xl border border-gray-200 bg-white/[0.02] px-4 py-3 text-sm text-gray-900 placeholder:text-gray-300 focus:outline-none transition-all duration-200"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase tracking-widest text-gray-400 font-medium">
                          Postal Code
                        </label>
                        <input
                          type="text"
                          value={deliveryAddress.postalCode}
                          onChange={(e) => setDeliveryAddress((a) => ({ ...a, postalCode: e.target.value }))}
                          placeholder="000000"
                          autoComplete="postal-code"
                          className="w-full rounded-xl border border-gray-200 bg-white/[0.02] px-4 py-3 text-sm text-gray-900 placeholder:text-gray-300 focus:outline-none transition-all duration-200"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase tracking-widest text-gray-400 font-medium">
                          Country
                        </label>
                        <input
                          type="text"
                          value={deliveryAddress.country}
                          onChange={(e) => setDeliveryAddress((a) => ({ ...a, country: e.target.value }))}
                          placeholder="Trinidad & Tobago"
                          autoComplete="country-name"
                          className="w-full rounded-xl border border-gray-200 bg-white/[0.02] px-4 py-3 text-sm text-gray-900 placeholder:text-gray-300 focus:outline-none transition-all duration-200"
                        />
                      </div>
                    </div>

                    {shippingZones.length > 0 && (
                      <div className="space-y-2.5 pt-2">
                        <label className="text-[10px] uppercase tracking-widest text-gray-400 font-medium flex items-center gap-1.5">
                          <Truck className="w-3 h-3" /> Shipping Method <span style={{ color: primaryColor }}>*</span>
                        </label>
                        <div className="space-y-2">
                          {shippingZones.map((zone) => {
                            const isSelected = selectedShippingZone === zone.id;
                            const isFree = zone.freeAbove !== null && cartTotal >= zone.freeAbove;
                            return (
                              <button
                                key={zone.id}
                                type="button"
                                onClick={() => setSelectedShippingZone(zone.id)}
                                className="w-full flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all duration-200 min-h-[44px]"
                                style={{
                                  borderColor: isSelected ? `${primaryColor}40` : "rgba(0,0,0,0.04)",
                                  backgroundColor: isSelected ? `${primaryColor}08` : "rgba(0,0,0,0.02)",
                                }}
                              >
                                <div
                                  className="w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all duration-200"
                                  style={{ borderColor: isSelected ? primaryColor : "rgba(0,0,0,0.08)" }}
                                >
                                  {isSelected && (
                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: primaryColor }} />
                                  )}
                                </div>
                                <div className="flex-1">
                                  <div className="text-sm font-medium" style={{ color: isSelected ? "rgba(0,0,0,0.8)" : "rgba(0,0,0,0.5)" }}>
                                    {zone.name}
                                    {zone.carrier && <span className="text-gray-400 text-[11px] ml-1.5">via {zone.carrier}</span>}
                                  </div>
                                  {zone.estimatedDays && (
                                    <div className="text-[11px] text-gray-900/35">{zone.estimatedDays} business days</div>
                                  )}
                                </div>
                                <div className="text-sm font-medium tabular-nums" style={{ color: isSelected ? primaryColor : "rgba(0,0,0,0.4)" }}>
                                  {isFree || zone.baseFee === 0 ? (
                                    <span className="text-emerald-400">Free</span>
                                  ) : (
                                    formatPrice(zone.baseFee, zone.currency)
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                        {shippingZones.some((z) => z.freeAbove !== null) && (
                          <p className="text-[10px] text-gray-900/25 px-1">
                            Free shipping available on qualifying orders
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}

              {serviceItemsInCart.length > 0 && (
                <>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${primaryColor}12` }}>
                      <CalendarDays className="w-5 h-5" style={{ color: primaryColor }} />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold text-gray-900">Schedule Your Services</h2>
                      <p className="text-xs text-gray-400">Pick a date and time for each service</p>
                    </div>
                  </div>

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

                    const isScheduled = bd.date && bd.time;

                    return (
                      <div
                        key={key}
                        className="rounded-2xl border border-gray-200 overflow-hidden transition-all duration-200"
                        style={{
                          background: "linear-gradient(135deg, rgba(0,0,0,0.03) 0%, rgba(0,0,0,0.01) 100%)",
                        }}
                      >
                        <div
                          className="px-5 py-3.5 flex items-center justify-between border-b border-gray-200"
                          style={{ background: isScheduled ? `${primaryColor}06` : "transparent" }}
                        >
                          <div className="flex items-center gap-2.5">
                            {isScheduled ? (
                              <CheckCircle2 className="w-4 h-4" style={{ color: primaryColor }} />
                            ) : (
                              <Clock className="w-4 h-4 text-gray-400" />
                            )}
                            <h3 className="font-medium text-sm text-gray-800">{si.name}</h3>
                          </div>
                          {isScheduled && (
                            <span className="text-[10px] font-medium px-2 py-1 rounded-lg" style={{ backgroundColor: `${primaryColor}15`, color: primaryColor }}>
                              Scheduled
                            </span>
                          )}
                        </div>

                        <div className="p-5 space-y-4">
                          {staff.length > 0 && (
                            <div className="space-y-2.5">
                              <label className="text-[10px] uppercase tracking-widest text-gray-400 flex items-center gap-1.5 font-medium">
                                <User className="w-3 h-3" /> Staff Preference
                              </label>
                              <div className="flex gap-2 flex-wrap">
                                <button
                                  type="button"
                                  onClick={() => updateBd({ staffId: "" })}
                                  className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-all duration-200 min-h-[44px]"
                                  style={{
                                    borderColor: !bd.staffId ? `${primaryColor}40` : "rgba(0,0,0,0.04)",
                                    backgroundColor: !bd.staffId ? `${primaryColor}10` : "rgba(0,0,0,0.02)",
                                    color: !bd.staffId ? primaryColor : "rgba(0,0,0,0.4)",
                                  }}
                                >
                                  <User className="w-3.5 h-3.5" /> Any Available
                                </button>
                                {staff.map((s) => (
                                  <button
                                    key={s.id}
                                    type="button"
                                    onClick={() => updateBd({ staffId: s.id })}
                                    className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-all duration-200 min-h-[44px]"
                                    style={{
                                      borderColor: bd.staffId === s.id ? `${secondaryColor}40` : "rgba(0,0,0,0.04)",
                                      backgroundColor: bd.staffId === s.id ? `${secondaryColor}10` : "rgba(0,0,0,0.02)",
                                      color: bd.staffId === s.id ? secondaryColor : "rgba(0,0,0,0.4)",
                                    }}
                                  >
                                    <div
                                      className="h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold"
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

                          <div className="space-y-2.5">
                            <label className="text-[10px] uppercase tracking-widest text-gray-400 flex items-center gap-1.5 font-medium">
                              <Calendar className="w-3 h-3" /> Date
                            </label>
                            <input
                              type="date"
                              value={bd.date}
                              onChange={(e) => updateBd({ date: e.target.value, time: "" })}
                              min={new Date().toISOString().split("T")[0]}
                              className="w-full rounded-xl border border-gray-200 bg-white/[0.02] px-4 py-3 text-sm text-gray-900 focus:outline-none transition-all duration-200 min-h-[44px]"
                              style={{
                                borderColor: bd.date ? `${primaryColor}30` : undefined,
                              }}
                            />
                          </div>

                          {bd.date && closed && (
                            <div className="rounded-xl border border-red-500/20 bg-red-500/[0.04] px-4 py-3 text-sm text-red-300 flex items-center gap-2">
                              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                              Closed on{" "}
                              {new Date(bd.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" })}
                              . Please pick another date.
                            </div>
                          )}

                          {bd.date && !closed && slots.length > 0 && (
                            <div className="space-y-2.5">
                              <label className="text-[10px] uppercase tracking-widest text-gray-400 flex items-center gap-1.5 font-medium">
                                <Clock className="w-3 h-3" /> Available Times
                              </label>
                              <div
                                className="grid grid-cols-4 sm:grid-cols-6 gap-1.5 max-h-[200px] overflow-y-auto pr-1"
                                style={{ scrollbarWidth: "thin" }}
                              >
                                {slots.map((slot) => (
                                  <button
                                    key={slot}
                                    type="button"
                                    onClick={() => updateBd({ time: slot })}
                                    className="px-2 py-2.5 rounded-lg text-xs font-medium border transition-all duration-200 active:scale-95 min-h-[44px]"
                                    style={
                                      bd.time === slot
                                        ? {
                                            backgroundColor: primaryColor,
                                            borderColor: primaryColor,
                                            color: "#fff",
                                            boxShadow: `0 2px 12px ${primaryColor}30`,
                                          }
                                        : {
                                            borderColor: "rgba(0,0,0,0.04)",
                                            backgroundColor: "rgba(0,0,0,0.02)",
                                            color: "rgba(0,0,0,0.4)",
                                          }
                                    }
                                  >
                                    {slot}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {bd.date && !closed && slots.length === 0 && (
                            <div className="rounded-xl border border-gray-200 bg-white/[0.02] px-4 py-3 text-sm text-gray-400 text-center">
                              No time slots available for this date.
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}

          {currentStepKey === "payment" && (
            <div className="space-y-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${primaryColor}12` }}>
                  <CreditCard className="w-5 h-5" style={{ color: primaryColor }} />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">Payment</h2>
                  <p className="text-xs text-gray-400">Choose your payment method and review your order</p>
                </div>
              </div>

              <div
                className="rounded-2xl border border-gray-200 overflow-hidden"
                style={{ background: "linear-gradient(135deg, rgba(0,0,0,0.03) 0%, rgba(0,0,0,0.01) 100%)" }}
              >
                <div className="px-5 py-3 border-b border-gray-200">
                  <div className="text-[10px] uppercase tracking-widest text-gray-400 font-medium">Order Summary</div>
                </div>
                <div className="p-5 space-y-3">
                  {serviceItems.length > 0 && productItems.length > 0 && (
                    <div className="text-[10px] uppercase tracking-widest text-gray-900/25 font-medium">Services</div>
                  )}
                  {serviceItems.map((item) => (
                    <div key={`${item.id}_${item.itemType}`} className="flex justify-between text-sm items-center">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">{item.name}</span>
                        <span className="text-[10px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">x{item.quantity}</span>
                      </div>
                      <span className="text-gray-900 font-medium tabular-nums">{formatPrice(item.price * item.quantity, item.currency)}</span>
                    </div>
                  ))}

                  {serviceItems.length > 0 && productItems.length > 0 && (
                    <div className="text-[10px] uppercase tracking-widest text-gray-900/25 font-medium pt-2">Products</div>
                  )}
                  {productItems.map((item) => (
                    <div key={`${item.id}_${item.itemType}`} className="flex justify-between text-sm items-center">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">{item.name}</span>
                        <span className="text-[10px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">x{item.quantity}</span>
                      </div>
                      <span className="text-gray-900 font-medium tabular-nums">{formatPrice(item.price * item.quantity, item.currency)}</span>
                    </div>
                  ))}

                  <div className="border-t border-gray-200 pt-3 space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Subtotal</span>
                      <span className="text-gray-600 tabular-nums">{formatPrice(cartTotal, cartCurrency)}</span>
                    </div>
                    {discount > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-emerald-400/70">Discount ({promoCode?.code})</span>
                        <span className="text-emerald-400/70 tabular-nums">-{formatPrice(discount, cartCurrency)}</span>
                      </div>
                    )}
                    {estimatedTax > 0 && (
                      <div className="flex justify-between text-[11px]">
                        <span className="text-gray-400">Tax ({effectiveTaxRate}%)</span>
                        <span className="text-gray-400 tabular-nums">{formatPrice(estimatedTax, cartCurrency)}</span>
                      </div>
                    )}
                    {hasPhysicalProducts && (
                      <div className="flex justify-between text-[11px]">
                        <span className="text-gray-400">Shipping{activeZone ? ` (${activeZone.name})` : ""}</span>
                        <span className="text-gray-400 tabular-nums">
                          {shippingFee === 0 ? "Free" : formatPrice(shippingFee, cartCurrency)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between items-center pt-2 border-t border-gray-200">
                      <span className="text-base font-semibold" style={{ color: primaryColor }}>Total</span>
                      <span className="text-xl font-bold tabular-nums" style={{ color: primaryColor }}>{formatPrice(orderTotal, cartCurrency)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {serviceItemsInCart.length > 0 && (
                <div
                  className="rounded-2xl border border-gray-200 overflow-hidden"
                  style={{ background: "linear-gradient(135deg, rgba(0,0,0,0.03) 0%, rgba(0,0,0,0.01) 100%)" }}
                >
                  <div className="px-5 py-3 border-b border-gray-200">
                    <div className="text-[10px] uppercase tracking-widest text-gray-400 font-medium flex items-center gap-1.5">
                      <CalendarDays className="w-3 h-3" /> Appointments
                    </div>
                  </div>
                  <div className="p-5 space-y-3">
                    {serviceItemsInCart.map((si) => {
                      const bd = serviceBookings[`${si.id}_${si.itemType}`];
                      if (!bd) return null;
                      const staffMember = staff.find((s) => s.id === bd.staffId);
                      return (
                        <div key={`${si.id}_${si.itemType}`} className="flex items-start justify-between">
                          <div>
                            <div className="text-sm text-gray-700 font-medium">{si.name}</div>
                            {staffMember && <div className="text-[11px] text-gray-900/35 mt-0.5">with {staffMember.name}</div>}
                          </div>
                          <div className="text-right">
                            <div className="text-sm text-gray-700">
                              {bd.date &&
                                new Date(`${bd.date}T${bd.time || "00:00"}`).toLocaleDateString("en-US", {
                                  weekday: "short",
                                  month: "short",
                                  day: "numeric",
                                })}
                            </div>
                            <div className="text-[11px] font-medium" style={{ color: primaryColor }}>{bd.time}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div
                className="rounded-2xl border border-gray-200 overflow-hidden"
                style={{ background: "linear-gradient(135deg, rgba(0,0,0,0.03) 0%, rgba(0,0,0,0.01) 100%)" }}
              >
                <div className="px-5 py-3 border-b border-gray-200">
                  <div className="text-[10px] uppercase tracking-widest text-gray-400 font-medium flex items-center gap-1.5">
                    <CreditCard className="w-3 h-3" /> Payment Method
                  </div>
                </div>
                <div className="p-5 space-y-2">
                  {paymentMethods.map((pm) => {
                    const isSelected = selectedPayment === pm.id;
                    return (
                      <button
                        key={pm.id}
                        type="button"
                        onClick={() => setSelectedPayment(pm.id)}
                        className="w-full flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-all duration-200 min-h-[44px]"
                        style={{
                          borderColor: isSelected ? `${primaryColor}40` : "rgba(0,0,0,0.04)",
                          backgroundColor: isSelected ? `${primaryColor}08` : "rgba(0,0,0,0.02)",
                        }}
                      >
                        <div
                          className="w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all duration-200"
                          style={{
                            borderColor: isSelected ? primaryColor : "rgba(0,0,0,0.08)",
                          }}
                        >
                          {isSelected && (
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: primaryColor }} />
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="text-sm font-medium" style={{ color: isSelected ? "rgba(0,0,0,0.8)" : "rgba(0,0,0,0.5)" }}>
                            {pm.name}
                          </div>
                          <div className="text-[11px] text-gray-900/35">{pm.description}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div
                className="rounded-2xl border border-gray-200 overflow-hidden"
                style={{ background: "linear-gradient(135deg, rgba(0,0,0,0.03) 0%, rgba(0,0,0,0.01) 100%)" }}
              >
                <div className="px-5 py-3 border-b border-gray-200">
                  <div className="text-[10px] uppercase tracking-widest text-gray-400 font-medium flex items-center gap-1.5">
                    <UserCircle className="w-3 h-3" /> Contact Info
                  </div>
                </div>
                <div className="p-5">
                  <div className="text-sm text-gray-700 font-medium">{firstName} {lastName}</div>
                  <div className="text-[11px] text-gray-400 mt-1">{emailInput}</div>
                  {phoneInput && <div className="text-[11px] text-gray-400">{phoneInput}</div>}
                  {hasPhysicalProducts && deliveryAddress.street && (
                    <div className="text-[11px] text-gray-400 mt-2 flex items-start gap-1.5">
                      <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0" />
                      <span>
                        {deliveryAddress.street}, {deliveryAddress.city}
                        {deliveryAddress.state ? `, ${deliveryAddress.state}` : ""}
                        {deliveryAddress.postalCode ? ` ${deliveryAddress.postalCode}` : ""}
                        {deliveryAddress.country ? `, ${deliveryAddress.country}` : ""}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <label className="flex items-start gap-3 cursor-pointer group px-1">
                <div className="relative mt-0.5">
                  <input
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={(e) => setTermsAccepted(e.target.checked)}
                    className="sr-only"
                  />
                  <div
                    className="w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all duration-200"
                    style={{
                      borderColor: termsAccepted ? primaryColor : "rgba(0,0,0,0.08)",
                      backgroundColor: termsAccepted ? primaryColor : "transparent",
                    }}
                  >
                    {termsAccepted && <CheckCircle2 className="w-3 h-3 text-gray-900" />}
                  </div>
                </div>
                <span className="text-xs text-gray-500 leading-relaxed">
                  I agree to the terms of service and understand that all fees are shown above. No additional charges will be applied.
                </span>
              </label>

              {business.refundPolicy && (
                <div className="rounded-2xl border border-gray-200 overflow-hidden">
                  <button
                    onClick={() => setShowRefundPolicy(!showRefundPolicy)}
                    className="w-full px-5 py-3 flex items-center justify-between text-left min-h-[44px]"
                    style={{ background: "rgba(0,0,0,0.02)" }}
                  >
                    <span className="text-xs text-gray-400 font-medium">Refund Policy</span>
                    {showRefundPolicy ? (
                      <ChevronUp className="w-4 h-4 text-gray-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-gray-400" />
                    )}
                  </button>
                  {showRefundPolicy && (
                    <div className="px-5 py-3 border-t border-gray-200 text-xs text-gray-400 leading-relaxed">
                      {business.refundPolicy}
                    </div>
                  )}
                </div>
              )}

              <div
                className="rounded-2xl border border-gray-200 p-4 flex items-center justify-between gap-3"
                style={{ background: "linear-gradient(135deg, rgba(16,185,129,0.03) 0%, rgba(16,185,129,0.01) 100%)" }}
              >
                {[
                  { icon: ShieldCheck, label: "Secure Checkout" },
                  { icon: Lock, label: "Encrypted" },
                  { icon: Award, label: "Guaranteed by KeyFlowOS" },
                ].map(({ icon: Icon, label }) => (
                  <div key={label} className="flex items-center gap-1.5 text-[11px] text-emerald-400/60">
                    <Icon className="w-3.5 h-3.5" />
                    <span>{label}</span>
                  </div>
                ))}
              </div>

              {(business.whatsapp || business.email) && (
                <div className="flex items-center justify-center">
                  <a
                    href={business.whatsapp
                      ? `https://wa.me/${business.whatsapp.replace(/\D/g, "")}?text=Hi, I have a question about my order`
                      : `mailto:${business.email}?subject=Question about my order`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-gray-500 transition-colors"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    Questions? Contact us
                  </a>
                </div>
              )}

              {error && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3 text-sm text-red-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-2">
          {checkoutStep > 0 && (
            <button
              onClick={goBack}
              className="flex-1 py-3.5 rounded-2xl border border-gray-200 text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-all duration-200 active:scale-[0.98] min-h-[44px]"
            >
              Back
            </button>
          )}
          {checkoutStep < checkoutSteps.length - 1 ? (
            <button
              onClick={goNext}
              disabled={!canProceedStep}
              className="flex-1 py-3.5 rounded-2xl text-gray-900 text-sm font-semibold transition-all duration-300 hover:scale-[1.01] active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2 group min-h-[44px]"
              style={{ backgroundColor: primaryColor, boxShadow: canProceedStep ? `0 4px 20px ${primaryColor}25` : "none" }}
            >
              Continue
              <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </button>
          ) : (
            <button
              onClick={handleSubmitOrder}
              disabled={submitting || !canProceedStep}
              className="flex-1 py-4 rounded-2xl text-gray-900 font-semibold text-sm transition-all duration-300 hover:scale-[1.01] active:scale-[0.98] hover:shadow-lg disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:scale-100 relative overflow-hidden group min-h-[44px]"
              style={{ backgroundColor: primaryColor, boxShadow: `0 8px 32px ${primaryColor}30` }}
            >
              <span
                className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                style={{
                  background: `linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.05) 50%, transparent 100%)`,
                }}
              />
              {submitting ? (
                <span className="relative flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Processing...
                </span>
              ) : (
                <span className="relative flex items-center justify-center gap-2">
                  <ShieldCheck className="w-4 h-4" />
                  Place Order
                </span>
              )}
            </button>
          )}
        </div>

        <div
          className="rounded-2xl border p-3 flex items-center justify-between sm:hidden"
          style={{
            borderColor: `${primaryColor}15`,
            background: `linear-gradient(135deg, ${primaryColor}05 0%, ${primaryColor}02 100%)`,
          }}
        >
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-4 h-4 text-gray-400" />
            <span className="text-xs text-gray-500">
              {cart.length} {cart.length === 1 ? "item" : "items"}
            </span>
          </div>
          <span className="text-sm font-bold tabular-nums" style={{ color: primaryColor }}>
            {formatPrice(orderTotal, cartCurrency)}
          </span>
        </div>

        <div className="flex items-center justify-center gap-1.5 text-[10px] text-gray-300 pb-4">
          <Lock className="w-3 h-3" />
          <span>Powered by KeyFlowOS · Secure Checkout</span>
        </div>
      </div>

      <style jsx>{`
        @keyframes stepForward {
          from { opacity: 0; transform: translateX(24px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes stepBack {
          from { opacity: 0; transform: translateX(-24px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
