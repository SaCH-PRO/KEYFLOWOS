"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Zap, Check, ArrowRight, Sparkles } from "lucide-react";

const plans = [
  {
    id: "FREE",
    name: "Free",
    tagline: "Get started with the essentials",
    priceTTD: 0,
    priceUSD: 0,
    features: [
      "Up to 50 contacts",
      "5 invoices per month",
      "10 bookings per month",
      "1 staff member",
      "10 products/services",
      "Basic CRM",
      "Public booking page",
    ],
  },
  {
    id: "FLOW",
    name: "Flow",
    tagline: "For growing businesses",
    priceTTD: 99,
    priceUSD: 15,
    popular: true,
    features: [
      "Up to 500 contacts",
      "Unlimited invoices",
      "100 bookings per month",
      "5 staff members",
      "100 products/services",
      "Quotes & proposals",
      "5 automations",
      "Online store",
      "20 social posts/month",
      "Custom branding",
    ],
  },
  {
    id: "KEYFLOW",
    name: "KeyFlow",
    tagline: "Full autopilot for your business",
    priceTTD: 249,
    priceUSD: 39,
    features: [
      "Unlimited contacts",
      "Unlimited invoices",
      "Unlimited bookings",
      "Unlimited staff",
      "Unlimited products/services",
      "Unlimited automations",
      "AI Autopilot & suggestions",
      "Online store",
      "Unlimited social posts",
      "Custom branding",
      "Priority support",
      "Advanced analytics",
    ],
  },
];

export default function PricingPage() {
  const [currency, setCurrency] = useState<"TTD" | "USD">("TTD");

  return (
    <div className="relative min-h-screen bg-[#0a0807] text-white overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-orange-500/10 via-transparent to-teal-500/10" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-gradient-to-b from-orange-500/20 to-transparent blur-3xl rounded-full" />

      <div className="relative z-10 max-w-6xl mx-auto px-6 py-12">
        <nav className="flex items-center justify-between mb-16">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold">KEYFLOWOS</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/auth/login" className="text-gray-400 hover:text-white transition-colors">
              Log in
            </Link>
            <Link
              href="/auth/signup"
              className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 transition-colors font-medium"
            >
              Start Free
            </Link>
          </div>
        </nav>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            Simple, transparent pricing
          </h1>
          <p className="text-lg text-gray-400 max-w-xl mx-auto mb-8">
            Start free. Upgrade when you're ready. 1-day free trial on all paid plans.
          </p>

          <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-white/5 border border-white/10">
            <button
              onClick={() => setCurrency("TTD")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                currency === "TTD"
                  ? "bg-orange-500 text-white shadow-lg"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              TTD $
            </button>
            <button
              onClick={() => setCurrency("USD")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                currency === "USD"
                  ? "bg-orange-500 text-white shadow-lg"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              USD $
            </button>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {plans.map((plan, i) => {
            const price = currency === "TTD" ? plan.priceTTD : plan.priceUSD;
            const isPopular = plan.popular;

            return (
              <motion.div
                key={plan.id}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 + i * 0.1 }}
                className={`relative rounded-2xl p-6 flex flex-col ${
                  isPopular
                    ? "bg-gradient-to-b from-orange-500/10 to-teal-500/5 border-2 border-orange-500/50 shadow-xl shadow-orange-500/10"
                    : "bg-white/5 border border-white/10"
                }`}
              >
                {isPopular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-gradient-to-r from-orange-500 to-orange-600 text-xs font-semibold text-white shadow-lg">
                      <Sparkles className="w-3 h-3" />
                      Most Popular
                    </span>
                  </div>
                )}

                <div className="mb-6">
                  <h3 className="text-xl font-bold mb-1">{plan.name}</h3>
                  <p className="text-sm text-gray-400">{plan.tagline}</p>
                </div>

                <div className="mb-6">
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold">
                      {currency === "TTD" ? "TT" : "US"}${price}
                    </span>
                    {price > 0 && (
                      <span className="text-gray-400 text-sm">/month</span>
                    )}
                  </div>
                  {price > 0 && (
                    <p className="text-xs text-orange-400 mt-1">1-day free trial</p>
                  )}
                </div>

                <ul className="space-y-3 mb-8 flex-1">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm">
                      <Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                      <span className="text-gray-300">{feature}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  href={plan.id === "FREE" ? "/auth/signup" : `/auth/signup?plan=${plan.id}&currency=${currency}`}
                  className={`flex items-center justify-center gap-2 w-full py-3 rounded-xl font-semibold transition-all text-sm ${
                    isPopular
                      ? "bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white shadow-lg"
                      : plan.id === "KEYFLOW"
                      ? "bg-white/10 hover:bg-white/15 text-white border border-white/20"
                      : "bg-white/5 hover:bg-white/10 text-white border border-white/10"
                  }`}
                >
                  {plan.id === "FREE" ? "Get Started Free" : `Start Free Trial`}
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </motion.div>
            );
          })}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.6 }}
          className="text-center mt-16"
        >
          <p className="text-gray-500 text-sm mb-2">
            All plans include WiPay + PayPal payment processing for your clients
          </p>
          <p className="text-gray-600 text-xs">
            Prices in {currency === "TTD" ? "Trinidad & Tobago Dollars" : "US Dollars"}. Cancel anytime.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
