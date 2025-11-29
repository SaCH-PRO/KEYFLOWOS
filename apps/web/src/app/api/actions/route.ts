import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const type = body?.type as string | undefined;
  const contactEmail = body?.contactEmail as string | undefined;
  const invoiceId = body?.invoiceId as string | undefined;

  if (!type) return NextResponse.json({ message: "Missing action type" }, { status: 400 });

  // Stub responses; wire to real messaging service later
  if (type === "remind-contact" && contactEmail) {
    return NextResponse.json({ message: `Reminder prepared for ${contactEmail}` });
  }

  if (type === "send-receipt" && invoiceId) {
    return NextResponse.json({ message: `Receipt will be sent for invoice ${invoiceId}` });
  }

  return NextResponse.json({ message: "Action acknowledged" });
}
