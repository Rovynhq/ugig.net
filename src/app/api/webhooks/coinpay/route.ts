import { NextRequest } from "next/server";
import { processCoinPayWebhook } from "@/app/api/payments/coinpayportal/webhook/route";

/**
 * Unified CoinPay webhook for funding, crypto, card-routed, invoice, and escrow
 * events.
 * CoinPay only supports one webhook URL per business; it re-signs both
 * crypto and Stripe-routed events with its own HMAC.
 */
export async function POST(request: NextRequest) {
  return processCoinPayWebhook(request, [
    process.env.COINPAY_WEBHOOK_SECRET,
    process.env.COINPAY_FUNDING_WEBHOOK_SECRET,
  ]);
}
