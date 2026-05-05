import Image from "next/image";
import type { CSSProperties } from "react";
import sanitizeHtml from "sanitize-html";

type PresenceSection = {
  id: string;
  type: string;
  visible: boolean;
  data: Record<string, unknown>;
};

type PresencePayload = {
  branding: { logoUrl?: string; primaryColor?: string; secondaryColor?: string; faviconUrl?: string; fontPairing?: string };
  sections: PresenceSection[];
  seo: { metaTitle?: string; metaDescription?: string };
  slug?: string;
  customDomain?: string;
};

type DayHours = { open: string; close: string; closed: boolean };
type BusinessHours = Record<string, DayHours>;

type PublicBusiness = {
  id: string; name: string; slug?: string | null; logoUrl?: string | null; tagline?: string | null;
  description?: string | null; address?: string | null; city?: string | null; country?: string | null;
  phone?: string | null; email?: string | null; whatsapp?: string | null;
  businessHours?: BusinessHours | null;
};

const DAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const DAY_LABELS: Record<(typeof DAY_ORDER)[number], string> = {
  monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu",
  friday: "Fri", saturday: "Sat", sunday: "Sun",
};

export default function PresenceRenderer({ business, payload, preview }: { business: PublicBusiness; payload: PresencePayload; preview?: boolean }) {
  const primary = payload.branding?.primaryColor || "#F97316";
  const secondary = payload.branding?.secondaryColor || "#14B8A6";
  const fontVar = fontFamilyFor(payload.branding?.fontPairing);
  const cssVars: CSSProperties = { ["--ps-primary" as never]: primary, ["--ps-secondary" as never]: secondary, fontFamily: fontVar };

  return (
    <main className="min-h-screen bg-white text-slate-900" style={cssVars} data-preview={preview ? "true" : undefined}>
      {payload.sections.filter((s) => s.visible).map((s) => (
        <SectionRender key={s.id} section={s} business={business} />
      ))}
      <footer className="px-6 py-8 border-t border-slate-200 text-xs text-slate-500 text-center">
        © {new Date().getFullYear()} {business.name}
      </footer>
    </main>
  );
}

function fontFamilyFor(pairing?: string): string {
  switch (pairing) {
    case "playfair-lato": return "'Playfair Display', Georgia, serif";
    case "poppins-opensans": return "'Poppins', system-ui, sans-serif";
    case "montserrat-roboto": return "'Montserrat', system-ui, sans-serif";
    case "dmserif-dmsans": return "'DM Serif Display', Georgia, serif";
    case "raleway-merriweather": return "'Raleway', system-ui, sans-serif";
    default: return "'Inter', system-ui, sans-serif";
  }
}

function SectionRender({ section, business }: { section: PresenceSection; business: PublicBusiness }) {
  const data = section.data ?? {};
  switch (section.type) {
    case "hero": {
      const cover = (data.coverImageUrl as string) || "";
      const heroBg = cover
        ? { backgroundImage: `linear-gradient(135deg, color-mix(in srgb, var(--ps-primary) 70%, transparent), color-mix(in srgb, var(--ps-secondary) 70%, transparent)), url(${JSON.stringify(cover)})`, backgroundSize: "cover", backgroundPosition: "center" }
        : { background: `linear-gradient(135deg, var(--ps-primary), var(--ps-secondary))` };
      return (
        <section className="relative px-6 py-16 sm:py-24 text-center" style={{ ...heroBg, color: "white" }}>
          {business.logoUrl && (
            <Image src={business.logoUrl} alt="" width={64} height={64} className="mx-auto mb-4 rounded-2xl" unoptimized />
          )}
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight max-w-3xl mx-auto">{(data.headline as string) || business.name}</h1>
          {data.subheadline ? <p className="mt-3 text-base sm:text-lg opacity-90 max-w-2xl mx-auto">{data.subheadline as string}</p> : null}
          {data.ctaLabel ? (
            <a href={business.slug ? `/book/${business.slug}` : "#"} className="inline-block mt-6 px-5 py-2.5 rounded-lg bg-white/95 text-slate-900 text-sm font-semibold">
              {data.ctaLabel as string}
            </a>
          ) : null}
        </section>
      );
    }
    case "about":
      return (
        <section className="px-6 py-12 max-w-3xl mx-auto">
          <h2 className="text-2xl font-semibold mb-3">{(data.heading as string) || "About us"}</h2>
          <p className="text-sm leading-relaxed text-slate-700 whitespace-pre-line">{(data.body as string) || ""}</p>
        </section>
      );
    case "services":
    case "products":
      return (
        <section className="px-6 py-12 max-w-4xl mx-auto">
          <h2 className="text-2xl font-semibold mb-3">{(data.heading as string) || (section.type === "services" ? "Services" : "Products")}</h2>
          <p className="text-sm text-slate-500">Browse our {section.type} on the booking page →</p>
          {business.slug && <a className="inline-block mt-3 text-sm font-semibold" style={{ color: "var(--ps-primary)" }} href={`/book/${business.slug}`}>Open catalog</a>}
        </section>
      );
    case "trust":
      return (
        <section className="px-6 py-10 bg-slate-50">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-xl font-semibold mb-3">{(data.heading as string) || "Why choose us"}</h2>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              {((data.items as string[]) ?? []).map((it, i) => (
                <li key={i} className="flex items-center gap-2 px-3 py-2 rounded-md bg-white border border-slate-200">{it}</li>
              ))}
            </ul>
          </div>
        </section>
      );
    case "gallery":
      return (
        <section className="px-6 py-10 max-w-5xl mx-auto">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {((data.images as string[]) ?? []).map((src, i) => (
              <div key={i} className="aspect-square relative rounded-lg overflow-hidden bg-slate-100">
                <Image src={src} alt="" fill className="object-cover" unoptimized />
              </div>
            ))}
          </div>
        </section>
      );
    case "faq":
      return (
        <section className="px-6 py-12 max-w-3xl mx-auto">
          <h2 className="text-2xl font-semibold mb-3">FAQ</h2>
          <div className="space-y-2">
            {((data.entries as { question: string; answer: string }[]) ?? []).map((e, i) => (
              <details key={i} className="rounded-md border border-slate-200 p-3">
                <summary className="text-sm font-medium cursor-pointer">{e.question}</summary>
                <p className="text-sm text-slate-600 mt-2 whitespace-pre-line">{e.answer}</p>
              </details>
            ))}
          </div>
        </section>
      );
    case "contact":
      return (
        <section className="px-6 py-12 max-w-3xl mx-auto">
          <h2 className="text-2xl font-semibold mb-3">{(data.heading as string) || "Contact us"}</h2>
          <ul className="text-sm text-slate-700 space-y-1">
            {data.showWhatsApp !== false && business.whatsapp ? <li>WhatsApp: <a className="underline" href={`https://wa.me/${business.whatsapp.replace(/[^0-9]/g, "")}`}>{business.whatsapp}</a></li> : null}
            {data.showEmail !== false && business.email ? <li>Email: <a className="underline" href={`mailto:${business.email}`}>{business.email}</a></li> : null}
            {data.showPhone !== false && business.phone ? <li>Phone: <a className="underline" href={`tel:${business.phone}`}>{business.phone}</a></li> : null}
          </ul>
        </section>
      );
    case "location": {
      const showMap = data.showMap !== false;
      const showHours = data.showHours !== false;
      const fullAddress = [business.address, business.city, business.country].filter(Boolean).join(", ");
      const mapSrc = showMap && fullAddress
        ? `https://www.google.com/maps?q=${encodeURIComponent(fullAddress)}&output=embed`
        : null;
      const hours = (business.businessHours ?? null) as BusinessHours | null;
      return (
        <section className="px-6 py-12 max-w-4xl mx-auto">
          <h2 className="text-2xl font-semibold mb-4">Find us</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              {fullAddress ? <p className="text-sm text-slate-700 mb-3">{fullAddress}</p> : null}
              {showHours && hours ? (
                <ul className="text-sm text-slate-700 divide-y divide-slate-100 border border-slate-200 rounded-md">
                  {DAY_ORDER.map((d) => {
                    const dh = hours[d];
                    return (
                      <li key={d} className="flex justify-between px-3 py-1.5">
                        <span className="font-medium text-slate-600">{DAY_LABELS[d]}</span>
                        <span>{!dh || dh.closed ? "Closed" : `${dh.open}–${dh.close}`}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
            {mapSrc ? (
              <div className="aspect-video rounded-md overflow-hidden border border-slate-200">
                <iframe
                  src={mapSrc}
                  title="Map"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  className="w-full h-full"
                />
              </div>
            ) : null}
          </div>
        </section>
      );
    }
    case "custom_html": {
      // Allowlist sanitization via sanitize-html before rendering
      // operator-supplied HTML on the public page. Scripts, event handlers,
      // javascript: URLs, form/iframe/object/embed elements are stripped.
      const raw = (data.html as string) || "";
      const safe = sanitizeHtml(raw, {
        allowedTags: [
          "h1", "h2", "h3", "h4", "h5", "h6", "p", "blockquote", "ul", "ol", "li", "br", "hr",
          "strong", "em", "b", "i", "u", "s", "code", "pre", "a", "img", "figure", "figcaption",
          "div", "span", "section", "article", "table", "thead", "tbody", "tr", "td", "th",
        ],
        allowedAttributes: {
          a: ["href", "name", "target", "rel"],
          img: ["src", "alt", "title", "width", "height"],
          "*": ["class"],
        },
        allowedSchemes: ["http", "https", "mailto", "tel"],
        allowedSchemesAppliedToAttributes: ["href", "src"],
        allowProtocolRelative: false,
        disallowedTagsMode: "discard",
      });
      return (
        <section className="px-6 py-8 max-w-4xl mx-auto" dangerouslySetInnerHTML={{ __html: safe }} />
      );
    }
    default:
      return null;
  }
}
