import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/get-user";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

// POST /api/gigs/[id]/invoice/[invoiceId]/request-new
// Lets the payer ask the worker for a fresh invoice instead of recreating a
// payment request from stale or expired payment details.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; invoiceId: string }> }
) {
  try {
    const { id: gigId, invoiceId } = await params;
    const auth = await getAuthContext(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { user, supabase } = auth;
    const { data: invoice, error } = await (supabase as any)
      .from("gig_invoices")
      .select(
        `
          id,
          gig_id,
          worker_id,
          poster_id,
          amount_usd,
          status,
          gig:gigs(id, title)
        `
      )
      .eq("id", invoiceId)
      .eq("gig_id", gigId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    if (invoice.poster_id !== user.id) {
      return NextResponse.json({ error: "Only the payer can request a new invoice" }, { status: 403 });
    }

    const gig = Array.isArray(invoice.gig) ? invoice.gig[0] : invoice.gig;
    const title = gig?.title || "your gig";
    const serviceSupabase = createServiceClient();

    await (serviceSupabase.from("notifications") as any).insert({
      user_id: invoice.worker_id,
      type: "payment_received",
      title: "New invoice requested",
      body: `The payment request for "${title}" is no longer payable. Please send a fresh invoice before the client pays.`,
      data: {
        gig_id: invoice.gig_id,
        invoice_id: invoice.id,
        previous_status: invoice.status,
      },
    });

    return NextResponse.json({ data: { requested: true } });
  } catch (err) {
    console.error("[request new invoice] failed:", err);
    return NextResponse.json({ error: "Failed to request a new invoice" }, { status: 500 });
  }
}
