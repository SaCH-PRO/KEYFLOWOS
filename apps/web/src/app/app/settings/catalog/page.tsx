"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Package, CalendarClock, ShoppingBag, ArrowRight, Layers } from "lucide-react";

/**
 * Settings → Catalog
 *
 * Single shared editor surface for the new Catalog domain (S1).
 * Products and Services now live in one place; Store, Commerce, and
 * Bookings all read from this catalog. The deep links below take you
 * to the rich editors that already exist for each surface — they all
 * write through the canonical Catalog API.
 */
export default function SettingsCatalogPage() {
  const cards = [
    {
      href: "/app/commerce/products",
      icon: Package,
      title: "Products",
      description:
        "Pricing, variants, fulfillment, inventory mode, execution model, and intake settings. Used by the storefront, quotes & invoices, and bookings.",
      cta: "Manage products",
    },
    {
      href: "/app/bookings",
      icon: CalendarClock,
      title: "Services & schedules",
      description:
        "Bookable services with duration, buffer, lead time, and the source product link used by Bookings and Revenue.",
      cta: "Manage services",
    },
    {
      href: "/app/store",
      icon: ShoppingBag,
      title: "Storefront presentation",
      description:
        "How the public store displays the same catalog: sections, cards, and merchandising. Owned by Presence.",
      cta: "Open Store editor",
    },
  ];

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-start gap-3"
      >
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center text-white shadow">
          <Layers className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Catalog</h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Your single source of truth for what you sell — products and services. Store, Commerce
            (quotes & invoices), and Bookings all read from this catalog. Edit once, reflected
            everywhere.
          </p>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {cards.map((c, i) => (
          <motion.div
            key={c.href}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * i }}
          >
            <Link
              href={c.href}
              className="group block rounded-2xl border border-border/60 bg-background hover:bg-muted/40 transition-colors p-5 h-full"
            >
              <div className="flex items-center gap-2 mb-3">
                <c.icon className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-medium">{c.title}</h3>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{c.description}</p>
              <div className="mt-4 flex items-center gap-1 text-sm font-medium text-foreground/80 group-hover:text-foreground">
                {c.cta}
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </div>
            </Link>
          </motion.div>
        ))}
      </div>

      <div className="rounded-2xl border border-dashed border-border/60 bg-muted/20 p-5">
        <h3 className="text-sm font-medium mb-1">For developers</h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Catalog is the canonical owner of <code className="font-mono">Product</code> and{" "}
          <code className="font-mono">Service</code> CRUD. Use{" "}
          <code className="font-mono">/api/catalog/businesses/:id/products</code> and{" "}
          <code className="font-mono">/api/catalog/businesses/:id/services</code>. The legacy
          Commerce and Bookings endpoints still work but are deprecated pass-throughs — see
          <code className="font-mono"> docs/migrations/shared-catalog.md</code>.
        </p>
      </div>
    </div>
  );
}
