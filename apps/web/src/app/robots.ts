import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        disallow: ["/admin/", "/app/", "/api/", "/env-check", "/offline"],
      },
    ],
    host: process.env.NEXT_PUBLIC_SITE_URL,
  };
}
