import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Business Directory | KeyFlowOS",
  description:
    "Discover local Caribbean businesses on KeyFlow. Browse beauty, health, food, services and retail providers across the islands — and book appointments online.",
  openGraph: {
    type: "website",
    title: "Business Directory | KeyFlowOS",
    description:
      "Discover local Caribbean businesses on KeyFlow. Browse beauty, health, food, services and retail providers across the islands.",
    siteName: "KeyFlowOS",
  },
  robots: { index: true, follow: true },
};

export default function DirectoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
