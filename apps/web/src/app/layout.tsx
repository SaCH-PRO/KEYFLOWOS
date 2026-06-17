import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { RegisterSW } from "@/components/register-sw";
import { OfflineBanner } from "@/components/ui/offline-banner";
import { WebVitals } from "@/components/web-vitals";

export const metadata: Metadata = {
  title: "KEYFLOWOS",
  description: "The Operating System for Service Businesses - Manage bookings, payments, contacts, and automations",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "KEYFLOWOS",
  },
  formatDetection: {
    telephone: true,
  },
  icons: {
    icon: [
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#F97316",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="font-sans" suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="mobile-web-app-capable" content="yes" />
        {/* Immediate SW cleanup on localhost — must run BEFORE any chunk loads to prevent ChunkLoadError from stale Turbopack chunks. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var h = location.hostname;
                if (h !== 'localhost' && h !== '127.0.0.1') return;
                if (!('serviceWorker' in navigator)) return;
                
                // If a service worker is controlling this page, unregister it
                // and reload to ensure chunks load from the network, not cache.
                if (navigator.serviceWorker.controller) {
                  navigator.serviceWorker.getRegistrations().then(function(regs) {
                    return Promise.all(regs.map(function(reg) { return reg.unregister(); }));
                  }).then(function() {
                    if ('caches' in window) {
                      return caches.keys().then(function(keys) {
                        return Promise.all(keys.map(function(key) { return caches.delete(key); }));
                      });
                    }
                  }).then(function() {
                    // Hard reload to bypass all caches and fetch fresh chunks
                    window.location.href = window.location.href.split('#')[0] + (window.location.search ? '&' : '?') + '_sw_cleared=' + Date.now();
                  });
                }
              })();
            `,
          }}
        />
        {/* Global ChunkLoadError recovery — reload the page if a JS/CSS chunk fails to load */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var h = location.hostname;
                if (h !== 'localhost' && h !== '127.0.0.1') return;
                window.addEventListener('error', function(event) {
                  var msg = event.message || '';
                  var filename = event.filename || '';
                  // ChunkLoadError or 404 on Next.js chunks
                  if (msg.indexOf('ChunkLoadError') !== -1 || msg.indexOf('Loading chunk') !== -1 || filename.indexOf('/_next/static/') !== -1) {
                    console.warn('[ChunkLoadError] Detected failed chunk load. Reloading...', msg, filename);
                    window.location.reload();
                  }
                });
              })();
            `,
          }}
        />
        {/* Suppress the Next.js dev overlay for known upstream framework races.
            The errors are transient; the global-error boundary reloads once if needed. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var h = location.hostname;
                if (h !== 'localhost' && h !== '127.0.0.1') return;
                if (typeof window === 'undefined') return;
                var suppressed = [
                  /Rendered more hooks than during the previous render/i,
                  /Cannot use 'in' operator to search for 'headCacheNode'/i,
                  /Should not already be working/i,
                ];
                window.addEventListener('error', function(event) {
                  var err = event.error;
                  var msg = err && err.message ? err.message : (event.message || '');
                  var stack = err && err.stack ? err.stack : '';
                  for (var i = 0; i < suppressed.length; i++) {
                    if (suppressed[i].test(msg) && stack.indexOf('next/dist') !== -1) {
                      console.warn('[Next.js framework race] Known dev-only bug; suppressing overlay.');
                      event.preventDefault();
                      event.stopImmediatePropagation();
                      return;
                    }
                  }
                }, true);
              })();
            `,
          }}
        />

      </head>
      <body className="overscroll-none">
        <WebVitals />
        <RegisterSW />
        <OfflineBanner />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
