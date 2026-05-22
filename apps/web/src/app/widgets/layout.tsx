/**
 * Widget Layout — stripped-down shell for iframe embeddable widgets.
 * No sidebar, no header, no navigation. Just the content with minimal chrome.
 */
export const metadata = {
  title: 'KeyflowOS Widget',
  robots: { index: false, follow: false },
};

export default function WidgetLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
