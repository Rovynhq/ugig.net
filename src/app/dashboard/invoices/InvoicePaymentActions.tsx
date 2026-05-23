"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CryptoPaymentBox } from "@/components/payments/CryptoPaymentBox";
import { Loader2, RefreshCw } from "lucide-react";

type InvoiceStatus = "draft" | "sent" | "paid" | "cancelled" | "expired";

interface InvoicePaymentMetadata {
  payment_address?: string | null;
  amount_crypto?: string | number | null;
  payment_currency?: string | null;
  checkout_url?: string | null;
  expires_at?: string | null;
}

interface InvoicePaymentActionsProps {
  gigId: string;
  applicationId: string;
  amountUsd: number;
  currency: string;
  status: InvoiceStatus;
  payUrl: string | null;
  notes: string | null;
  dueDate: string | null;
  metadata: InvoicePaymentMetadata | null;
}

export function InvoicePaymentActions({
  gigId,
  applicationId,
  amountUsd,
  currency,
  status: initialStatus,
  payUrl: initialPayUrl,
  notes,
  dueDate,
  metadata: initialMetadata,
}: InvoicePaymentActionsProps) {
  const [status, setStatus] = useState<InvoiceStatus>(initialStatus);
  const [payUrl, setPayUrl] = useState(initialPayUrl);
  const [metadata, setMetadata] = useState<InvoicePaymentMetadata | null>(initialMetadata);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paymentAddress = metadata?.payment_address || null;
  const checkoutUrl = payUrl || metadata?.checkout_url || null;

  const createPaymentRequest = async () => {
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/gigs/${gigId}/invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          application_id: applicationId,
          amount: amountUsd,
          currency,
          notes: notes || undefined,
          due_date: dueDate || undefined,
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        setError(json.error || "Failed to create payment request");
        return;
      }

      const nextMetadata = json.data?.metadata || {
        payment_address: json.data?.payment_address || null,
        amount_crypto: json.data?.amount_crypto || null,
        payment_currency: json.data?.payment_currency || null,
        checkout_url: json.data?.pay_url || null,
        expires_at: json.data?.expires_at || null,
      };

      setStatus("sent");
      setPayUrl(json.data?.pay_url || null);
      setMetadata(nextMetadata);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (status === "paid" || status === "cancelled" || status === "draft") {
    return null;
  }

  if (status === "sent" && paymentAddress) {
    return (
      <CryptoPaymentBox
        title="Invoice payment"
        paymentAddress={paymentAddress}
        amountCrypto={metadata?.amount_crypto}
        paymentCurrency={metadata?.payment_currency}
        expiresAt={metadata?.expires_at}
        checkoutUrl={checkoutUrl}
      />
    );
  }

  return (
    <div className="rounded-md border border-border bg-muted/30 p-3 space-y-3">
      <p className="text-sm text-muted-foreground">
        {status === "expired"
          ? "This payment request expired. Create a new one to pay this invoice."
          : "Payment details are missing. Create a new payment request to pay this invoice."}
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button
        type="button"
        size="sm"
        onClick={createPaymentRequest}
        disabled={submitting}
        className="gap-2"
      >
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="h-4 w-4" />
        )}
        Create new payment request
      </Button>
    </div>
  );
}
