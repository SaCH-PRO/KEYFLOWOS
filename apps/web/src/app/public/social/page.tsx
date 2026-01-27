"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Badge, Button, Card, Input } from "@keyflow/ui";
import { fetchSiteBySubdomain, fetchSite, upsertSite } from "@/lib/client";

type SiteLink = { label: string; url: string };

export default function PublicSocialPage() {
  const searchParams = useSearchParams();
  const subdomainParam = searchParams?.get("subdomain") ?? "";
  const businessIdParam = searchParams?.get("businessId") ?? "";
  const [subdomain, setSubdomain] = useState(subdomainParam);
  const [businessId, setBusinessId] = useState(businessIdParam);
  const [title, setTitle] = useState("KeyFlow Social");
  const [links, setLinks] = useState<SiteLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const parsedLinks = useMemo(
    () =>
      links.filter((link) => link.label.trim() && link.url.trim()).map((link) => ({
        label: link.label.trim(),
        url: link.url.trim(),
      })),
    [links],
  );

  useEffect(() => {
    if (subdomainParam) setSubdomain(subdomainParam);
    if (businessIdParam) setBusinessId(businessIdParam);
  }, [subdomainParam, businessIdParam]);

  useEffect(() => {
    const load = async () => {
      if (subdomain) {
        setLoading(true);
        const res = await fetchSiteBySubdomain(subdomain);
        if (res.data?.siteData && typeof res.data.siteData === "object") {
          const data = res.data.siteData as { title?: string; links?: SiteLink[] };
          setTitle(data.title ?? "KeyFlow Social");
          setLinks(Array.isArray(data.links) ? data.links : []);
        }
        setLoading(false);
      } else if (businessId) {
        setLoading(true);
        const res = await fetchSite(businessId);
        if (res.data?.siteData && typeof res.data.siteData === "object") {
          const data = res.data.siteData as { title?: string; links?: SiteLink[] };
          setTitle(data.title ?? "KeyFlow Social");
          setLinks(Array.isArray(data.links) ? data.links : []);
        }
        setLoading(false);
      }
    };
    void load();
  }, [subdomain, businessId]);

  const handleSave = async () => {
    if (!businessId.trim()) {
      setStatus("Business ID required to save.");
      return;
    }
    const payload = { title, links: parsedLinks };
    const res = await upsertSite({ businessId, subdomain, siteData: payload });
    setStatus(res.error ?? "Saved.");
  };

  return (
    <main className="min-h-screen bg-background text-foreground px-4 py-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-col gap-2">
          <Badge tone="info">Public Links</Badge>
          <h1 className="text-3xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">Share your links instantly. Use ?subdomain= or ?businessId=.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
          <Card title="Links" badge={loading ? "Loading" : `${parsedLinks.length}`}>
            <div className="space-y-2">
              {parsedLinks.length === 0 && <div className="text-xs text-muted-foreground">No links yet.</div>}
              {parsedLinks.map((link) => (
                <a
                  key={`${link.label}-${link.url}`}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
                >
                  <span>{link.label}</span>
                  <span className="text-xs text-muted-foreground">{link.url}</span>
                </a>
              ))}
            </div>
          </Card>

          <Card title="Edit site" badge="Owner">
            <div className="space-y-2">
              <Input label="Business ID" value={businessId} onChange={(e) => setBusinessId(e.target.value)} />
              <Input label="Subdomain" value={subdomain} onChange={(e) => setSubdomain(e.target.value)} />
              <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
              {links.map((link, idx) => (
                <div key={`link-${idx}`} className="grid gap-2 md:grid-cols-2">
                  <Input
                    label="Label"
                    value={link.label}
                    onChange={(e) =>
                      setLinks((prev) => {
                        const next = [...prev];
                        next[idx] = { ...next[idx], label: e.target.value };
                        return next;
                      })
                    }
                  />
                  <Input
                    label="URL"
                    value={link.url}
                    onChange={(e) =>
                      setLinks((prev) => {
                        const next = [...prev];
                        next[idx] = { ...next[idx], url: e.target.value };
                        return next;
                      })
                    }
                  />
                </div>
              ))}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setLinks((prev) => [...prev, { label: "", url: "" }])}
                >
                  Add link
                </Button>
                <Button onClick={handleSave}>Save</Button>
              </div>
              {status && <div className="text-xs text-muted-foreground">{status}</div>}
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}
