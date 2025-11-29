import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const title = body?.title ?? "Update";
  const suggestion = body?.suggestion ?? "Review this event";

  const aiEndpoint = process.env.AI_SUGGEST_URL;

  if (aiEndpoint) {
    try {
      const res = await fetch(aiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (res.ok && json?.suggestion) {
        return NextResponse.json({ suggestion: json.suggestion });
      }
    } catch (err) {
      // fall back to stub below
    }
  }

  return NextResponse.json({
    suggestion: `AI suggests: ${suggestion} → triggered by "${title}"`,
  });
}
