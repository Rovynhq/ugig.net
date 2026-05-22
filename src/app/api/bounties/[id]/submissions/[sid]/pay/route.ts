import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/get-user";
import { createInvoice, sendInvoice } from "@/lib/coinpayportal";

// POST /api/bounties/[id]/submissions/[sid]/pay
// Creator generates a CoinPay payment link for an approved submission.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; sid: string }> }
) {
  try {
    const { id: bountyId, sid } = await params;
    const auth = await getAuthContext(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { user, supabase } = auth;

    const { data: bounty } = await (supabase as any)
      .from("bounties")
      .select("id, creator_id, title, payout_usd")
      .eq("id", bountyId)
      .single();
    if (!bounty) {
      return NextResponse.json({ error: "Bounty not found" }, { status: 404 });
    }
    if (bounty.creator_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: submission } = await (supabase as any)
      .from("bounty_submissions")
      .select("id, submitter_id, status, payout_status, pay_url, coinpay_invoice_id")
      .eq("id", sid)
      .eq("bounty_id", bountyId)
      .single();
    if (!submission) {
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }
    if (submission.status !== "approved") {
      return NextResponse.json(
        { error: "Only approved submissions can be paid" },
        { status: 400 }
      );
    }

    // Already has a pay link — return it
    if (submission.pay_url) {
      return NextResponse.json({
        data: {
          submission_id: sid,
          coinpay_invoice_id: submission.coinpay_invoice_id,
          pay_url: submission.pay_url,
        },
      });
    }

    // Create CoinPay invoice
    const invoiceResult = await createInvoice({
      amount: Number(bounty.payout_usd),
      currency: "USD",
      notes: `Bounty payout: ${bounty.title}`,
      metadata: {
        bounty_id: bountyId,
        submission_id: sid,
        creator_id: user.id,
        submitter_id: submission.submitter_id,
        kind: "bounty",
        platform: "ugig.net",
      },
    });
    const sendResult = await sendInvoice(invoiceResult.invoice.id);
    const payUrl = sendResult.invoice.pay_url || invoiceResult.invoice.pay_url;

    const { error: updateError } = await (supabase as any)
      .from("bounty_submissions")
      .update({
        payout_status: "invoiced",
        coinpay_invoice_id: invoiceResult.invoice.id,
        pay_url: payUrl,
      })
      .eq("id", sid);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    return NextResponse.json({
      data: {
        submission_id: sid,
        coinpay_invoice_id: invoiceResult.invoice.id,
        pay_url: payUrl,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
