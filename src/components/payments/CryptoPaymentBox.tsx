"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { QRCodeCanvas } from "@/components/funding/QRCode";
import { Copy, ExternalLink } from "lucide-react";

interface CryptoPaymentBoxProps {
  title?: string;
  paymentAddress: string;
  amountCrypto?: string | number | null;
  paymentCurrency?: string | null;
  expiresAt?: string | null;
  checkoutUrl?: string | null;
}

export function CryptoPaymentBox({
  title = "Payment details",
  paymentAddress,
  amountCrypto,
  paymentCurrency,
  expiresAt,
  checkoutUrl,
}: CryptoPaymentBoxProps) {
  const [copied, setCopied] = useState<"address" | "amount" | null>(null);
  const amountLabel =
    amountCrypto != null && amountCrypto !== ""
      ? `${amountCrypto} ${paymentCurrency || ""}`.trim()
      : paymentCurrency || null;

  const copy = async (value: string, key: "address" | "amount") => {
    await navigator.clipboard?.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1200);
  };

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 sm:p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="text-sm font-semibold text-foreground">{title}</span>
          {amountLabel && (
            <p className="mt-1 text-xs text-muted-foreground">
              Send the exact amount to the address below.
            </p>
          )}
        </div>
        {checkoutUrl && (
          <a
            href={checkoutUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
          >
            <ExternalLink className="h-3 w-3" />
            Open
          </a>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-[164px_1fr] sm:items-start">
        <div className="w-fit rounded-md border border-border bg-background p-2">
          <QRCodeCanvas value={paymentAddress} size={148} />
        </div>

        <div className="min-w-0 space-y-4">
          {amountLabel && (
            <div className="rounded-md border border-border bg-background p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-muted-foreground">Amount</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs"
                  onClick={() => copy(String(amountCrypto), "amount")}
                  disabled={amountCrypto == null || amountCrypto === ""}
                >
                  <Copy className="h-3 w-3" />
                  {copied === "amount" ? "Copied" : "Copy"}
                </Button>
              </div>
              <code className="block break-all text-sm font-semibold">
                {amountLabel}
              </code>
            </div>
          )}

          <div className="rounded-md border border-border bg-background p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-muted-foreground">Address</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs"
                onClick={() => copy(paymentAddress, "address")}
              >
                <Copy className="h-3 w-3" />
                {copied === "address" ? "Copied" : "Copy"}
              </Button>
            </div>
            <code className="block break-all text-xs leading-relaxed">
              {paymentAddress}
            </code>
          </div>

          {expiresAt && (
            <p className="text-xs text-muted-foreground">
              Expires {new Date(expiresAt).toLocaleString()}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
