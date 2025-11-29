import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const title = body?.title ?? "Update";
  const suggestion = body?.suggestion ?? "Review this event";

  return NextResponse.json({
    suggestion: `AI suggests: ${suggestion} → triggered by "${title}"`,
  });
}
