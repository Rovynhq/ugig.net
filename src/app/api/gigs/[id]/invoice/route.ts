import { NextRequest, NextResponse } from "next/server";
import { createServiceClient, getAuthContext } from "@/lib/auth/get-user";
import { createPayment, resolveSupportedPaymentCurrency } from "@/lib/coinpayportal";
import { invoiceReceivedEmail, sendEmail } from "@/lib/email";
import { z } from "zod";

const createInvoiceSchema = z.object({
  application_id: z.string().uuid(),
  amount: z.number().positive("Amount must be positive"),
  currency: z.string().default("USD"),
  notes: z.string().optional(),
  due_date: z.string().optional(),
});

const MIN_PAYMENT_REQUEST_HOURS = 27;
const MIN_PAYMENT_REQUEST_SECONDS = MIN_PAYMENT_REQUEST_HOURS * 60 * 60;

function getInvoiceExpiresAt(invoice: { metadata?: unknown }): Date | null {
  const metadata =
    invoice.metadata && typeof invoice.metadata === "object"
      ? (invoice.metadata as Record<string, unknown>)
      : null;
  const expiresAt = typeof metadata?.expires_at === "string" ? metadata.expires_at : null;
  if (!expiresAt) return null;
  const date = new Date(expiresAt);
  return Number.isNaN(date.getTime()) ? null : date;
}

function minimumPaymentExpiresAt(): Date {
  return new Date(Date.now() + MIN_PAYMENT_REQUEST_SECONDS * 1000);
}

// GET /api/gigs/[id]/invoice - Get invoices for a gig
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: gigId } = await params;
    const auth = await getAuthContext(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { user, supabase } = auth;

    // Get invoices where user is worker or poster
    const { data: invoices, error } = await (supabase as any)
      .from("gig_invoices")
      .select(`
        *,
        worker:profiles!worker_id(id, username, full_name, avatar_url),
        poster:profiles!poster_id(id, username, full_name, avatar_url)
      `)
      .eq("gig_id", gigId)
      .or(`worker_id.eq.${user.id},poster_id.eq.${user.id}`)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ data: invoices || [] });
  } catch {
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}

// POST /api/gigs/[id]/invoice - Create invoice for an accepted application
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: gigId } = await params;
    const auth = await getAuthContext(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { user, supabase } = auth;

    const body = await request.json();
    const validationResult = createInvoiceSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: validationResult.error.issues[0].message },
        { status: 400 }
      );
    }

    const { application_id, amount, currency, notes, due_date } = validationResult.data;

    // Get gig
    const { data: gig } = await supabase
      .from("gigs")
      .select("id, title, poster_id, payment_coin")
      .eq("id", gigId)
      .single();

    if (!gig) {
      return NextResponse.json({ error: "Gig not found" }, { status: 404 });
    }

    // Get application — must be accepted; the user must be either the worker
    // (self-billing) or the gig poster (paying the worker directly).
    const { data: application } = await supabase
      .from("applications")
      .select("id, applicant_id, status, proposed_rate")
      .eq("id", application_id)
      .eq("gig_id", gigId)
      .single();

    if (!application) {
      return NextResponse.json(
        { error: "Application not found" },
        { status: 404 }
      );
    }

    const isWorker = application.applicant_id === user.id;
    const isPoster = gig.poster_id === user.id;

    if (!isWorker && !isPoster) {
      return NextResponse.json(
        { error: "Only the worker or gig poster can create an invoice" },
        { status: 403 }
      );
    }

    if (application.status !== "accepted") {
      return NextResponse.json(
        { error: "Application must be accepted before creating an invoice" },
        { status: 400 }
      );
    }

    const workerId = application.applicant_id;
    const posterId = gig.poster_id;

    const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "https://ugig.net";
    const businessId = process.env.COINPAY_MERCHANT_ID;

    const { data: openInvoices } = await (supabase as any)
      .from("gig_invoices")
      .select("id, coinpay_invoice_id, pay_url, status, metadata")
      .eq("application_id", application_id)
      .in("status", ["draft", "sent"])
      .order("created_at", { ascending: false })
      .limit(1);

    const openInvoice = openInvoices?.[0] || null;
    if (openInvoice) {
      const expiresAt = getInvoiceExpiresAt(openInvoice);
      if (!expiresAt || expiresAt >= minimumPaymentExpiresAt()) {
        const metadata =
          openInvoice.metadata && typeof openInvoice.metadata === "object"
            ? (openInvoice.metadata as Record<string, unknown>)
            : {};

        return NextResponse.json(
          {
            data: {
              invoice_id: openInvoice.id,
              coinpay_invoice_id: openInvoice.coinpay_invoice_id,
              pay_url: openInvoice.pay_url,
              payment_address: metadata.payment_address || null,
              amount_crypto: metadata.amount_crypto || null,
              payment_currency: metadata.payment_currency || null,
              expires_at: metadata.expires_at || null,
              metadata: openInvoice.metadata,
            },
          },
          { status: 200 }
        );
      }

      await (supabase as any)
        .from("gig_invoices")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("id", openInvoice.id);
    }

    const paymentCurrency = await resolveSupportedPaymentCurrency(
      (gig as any).payment_coin,
      { business_id: businessId }
    );

    // Create a direct CoinPay payment request instead of a hosted invoice. The
    // poster should see payment details inside uGig, not be redirected away.
    const requiredExpiresAt = minimumPaymentExpiresAt();
    const paymentResult = await createPayment({
      amount_usd: amount,
      currency: paymentCurrency,
      description: notes || `Invoice for gig: ${gig.title}`,
      business_id: businessId,
      redirect_url: `${appUrl}/gigs/${gigId}?invoice=paid`,
      expires_at: requiredExpiresAt.toISOString(),
      expires_in: MIN_PAYMENT_REQUEST_SECONDS,
      metadata: {
        type: "gig_invoice",
        gig_id: gigId,
        application_id,
        worker_id: workerId,
        poster_id: posterId,
        initiated_by: isPoster ? "poster" : "worker",
        invoice_currency: currency,
        payment_currency: paymentCurrency,
        platform: "ugig.net",
      },
    });

    const cpPayment = paymentResult.payment || paymentResult;
    const paymentId = paymentResult.payment_id || (cpPayment as any).id;
    const paymentAddress = (cpPayment as any).payment_address || paymentResult.address || null;
    const checkoutUrl = paymentResult.checkout_url || (cpPayment as any).checkout_url || null;
    const amountCrypto =
      paymentResult.amount_crypto ||
      (cpPayment as any).amount_crypto ||
      (cpPayment as any).crypto_amount ||
      null;
    const expiresAt = paymentResult.expires_at || (cpPayment as any).expires_at || null;
    const responseCurrency = paymentResult.currency || (cpPayment as any).currency || paymentCurrency;
    const returnedExpiresAt = expiresAt ? new Date(expiresAt) : null;

    if (!paymentId) {
      return NextResponse.json(
        { error: "CoinPay did not return a payment id" },
        { status: 502 }
      );
    }

    if (!paymentAddress) {
      return NextResponse.json(
        { error: "CoinPay did not return an in-app payment address" },
        { status: 502 }
      );
    }

    if (
      !returnedExpiresAt ||
      Number.isNaN(returnedExpiresAt.getTime()) ||
      returnedExpiresAt.getTime() + 1000 < requiredExpiresAt.getTime()
    ) {
      return NextResponse.json(
        {
          error: `CoinPay payment requests must remain open for at least ${MIN_PAYMENT_REQUEST_HOURS} hours`,
        },
        { status: 502 }
      );
    }

    // Create local invoice record
    const { data: invoice, error } = await (supabase as any)
      .from("gig_invoices")
      .insert({
        gig_id: gigId,
        application_id,
        worker_id: workerId,
        poster_id: posterId,
        coinpay_invoice_id: paymentId,
        amount_usd: amount,
        currency,
        status: "sent",
        pay_url: null,
        notes,
        due_date: due_date || null,
        metadata: {
          payment_address: paymentAddress,
          amount_crypto: amountCrypto,
          payment_currency: responseCurrency,
          checkout_url: checkoutUrl,
          expires_at: expiresAt,
        },
      })
      .select()
      .single();

    if (error) {
      console.error("Failed to create invoice record:", error);
      return NextResponse.json(
        { error: "Failed to create invoice" },
        { status: 500 }
      );
    }

    // Notify the counterparty
    const { data: actorProfile } = await supabase
      .from("profiles")
      .select("username, full_name")
      .eq("id", user.id)
      .single();

    const actorName =
      actorProfile?.full_name || actorProfile?.username || (isPoster ? "The client" : "A worker");
    const recipientId = isPoster ? workerId : posterId;
    const notificationBody = isPoster
      ? `${actorName} prepared a $${amount} payment for "${gig.title}". Open the invoice to confirm.`
      : `${actorName} sent you a $${amount} invoice for "${gig.title}".`;

    await supabase.from("notifications").insert({
      user_id: recipientId,
      type: "payment_received",
      title: isPoster ? "Payment prepared" : "Invoice received",
      body: notificationBody,
      data: {
        gig_id: gigId,
        invoice_id: invoice.id,
      },
    });

    if (!isPoster) {
      try {
        const adminClient = createServiceClient();
        const { data: posterAuth } = await adminClient.auth.admin.getUserById(posterId);
        const posterEmail = posterAuth?.user?.email;

        if (posterEmail) {
          const { data: posterProfile } = await supabase
            .from("profiles")
            .select("username, full_name")
            .eq("id", posterId)
            .single();

          const posterName = posterProfile?.full_name || posterProfile?.username || "there";
          const emailContent = invoiceReceivedEmail({
            posterName,
            workerName: actorName,
            gigTitle: gig.title,
            amountUsd: amount,
            invoiceId: invoice.id,
          });

          await sendEmail({ to: posterEmail, ...emailContent });
        }
      } catch (emailError) {
        console.error("Failed to send invoice notification email:", emailError);
      }
    }

    return NextResponse.json({
      data: {
        invoice_id: invoice.id,
        coinpay_invoice_id: paymentId,
        pay_url: null,
        payment_address: paymentAddress,
        amount_crypto: amountCrypto,
        payment_currency: responseCurrency,
        expires_at: expiresAt,
        metadata: invoice.metadata,
      },
    }, { status: 201 });
  } catch (error) {
    console.error("Invoice creation error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
