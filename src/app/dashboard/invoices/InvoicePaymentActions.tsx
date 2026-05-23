"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CryptoPaymentBox } from "@/components/payments/CryptoPaymentBox";
import { CheckCircle2, Loader2, RefreshCw } from "lucide-react";

type InvoiceStatus = "draft" | "sent" | "paid" | "cancelled" | "expired";

interface InvoicePaymentMetadata {
  payment_address?: string | null;
  amount_crypto?: string | number | null;
  payment_currency?: string | null;
  checkout_url?: string | null;
  expires_at?: string | null;
}

interface InvoicePaymentActionsProps {
  invoiceId: string;
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
  invoiceId,
  gigId,
  status: initialStatus,
  payUrl: initialPayUrl,
  metadata: initialMetadata,
}: InvoicePaymentActionsProps) {
  const router = useRouter();
  const [status, setStatus] = useState<InvoiceStatus>(initialStatus);
  const [payUrl, setPayUrl] = useState(initialPayUrl);
  const [metadata, setMetadata] = useState<InvoicePaymentMetadata | null>(initialMetadata);
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const paymentAddress = metadata?.payment_address || null;
  const checkoutUrl = payUrl || metadata?.checkout_url || null;

  const checkPaymentStatus = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (status !== "sent" || !paymentAddress) return;

      if (!silent) {
        setChecking(true);
        setError(null);
      }

      try {
        const res = await fetch(
          `/api/gigs/${gigId}/invoice/${invoiceId}/payment-status`,
          { cache: "no-store" }
        );
        const json = await res.json();

        if (!res.ok) {
          if (!silent) setError(json.error || "Failed to check payment status");
          return;
        }

        const nextStatus = json.data?.status as InvoiceStatus | undefined;
        if (nextStatus) setStatus(nextStatus);
        if (json.data?.pay_url !== undefined) setPayUrl(json.data.pay_url);
        if (json.data?.metadata) setMetadata(json.data.metadata);

        if (nextStatus === "paid") {
          setStatusMessage("Payment confirmed.");
          router.refresh();
        } else if (nextStatus === "expired") {
          setStatusMessage("Payment request expired.");
          router.refresh();
        } else if (!silent) {
          setStatusMessage("Still waiting for confirmation.");
        }
      } catch {
        if (!silent) setError("Network error. Try again.");
      } finally {
        if (!silent) setChecking(false);
      }
    },
    [gigId, invoiceId, paymentAddress, router, status]
  );

  useEffect(() => {
    if (status !== "sent" || !paymentAddress) return;

    const interval = window.setInterval(() => {
      void checkPaymentStatus({ silent: true });
    }, 5000);

    return () => window.clearInterval(interval);
  }, [checkPaymentStatus, paymentAddress, status]);

  const createPaymentRequest = async () => {
    setSubmitting(true);
    setError(null);
    setStatusMessage(null);

    try {
      const res = await fetch(`/api/gigs/${gigId}/invoice/${invoiceId}/payment-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      setStatusMessage("Payment request created at the current market rate.");
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (status === "paid") {
    return (
      <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-4 text-sm text-green-700">
        <div className="flex items-center gap-2 font-medium">
          <CheckCircle2 className="h-4 w-4" />
          Payment confirmed
        </div>
      </div>
    );
  }

  if (status === "cancelled" || status === "draft") {
    return null;
  }

  if (status === "sent" && paymentAddress) {
    return (
      <div className="space-y-3">
        <CryptoPaymentBox
          title="Invoice payment"
          paymentAddress={paymentAddress}
          amountCrypto={metadata?.amount_crypto}
          paymentCurrency={metadata?.payment_currency}
          expiresAt={metadata?.expires_at}
          checkoutUrl={checkoutUrl}
        />

        <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Waiting for payment confirmation.
            {statusMessage ? ` ${statusMessage}` : ""}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => checkPaymentStatus()}
            disabled={checking}
            className="gap-2 self-start sm:self-auto"
          >
            {checking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Check payment
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
      <p className="text-sm text-muted-foreground">
        {status === "expired"
          ? "The last payment request expired, but this invoice is still payable. Create a fresh payment request when you're ready to pay."
          : "Create a payment request when you're ready to pay. The crypto amount will be quoted at the current market rate."}
      </p>
      {statusMessage && <p className="text-sm text-green-700">{statusMessage}</p>}
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
        Pay now
      </Button>
    </div>
  );
}
