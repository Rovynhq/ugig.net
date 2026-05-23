import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InvoicePaymentActions } from "./InvoicePaymentActions";

vi.mock("@/components/funding/QRCode", () => ({
  QRCodeCanvas: ({ value }: { value: string }) => <div data-testid="qr-code">{value}</div>,
}));

const baseProps = {
  gigId: "gig-1",
  applicationId: "app-1",
  amountUsd: 12,
  currency: "USD",
  payUrl: null,
  notes: "Work completed",
  dueDate: null,
};

describe("InvoicePaymentActions", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows in-app crypto payment details for sent invoices", () => {
    render(
      <InvoicePaymentActions
        {...baseProps}
        status="sent"
        metadata={{
          payment_address: "SolAddress123",
          amount_crypto: "0.25",
          payment_currency: "SOL",
          expires_at: "2026-05-24T00:00:00Z",
        }}
      />
    );

    expect(screen.getByText("Invoice payment")).toBeInTheDocument();
    expect(screen.getByText("0.25 SOL")).toBeInTheDocument();
    expect(screen.getAllByText("SolAddress123")).toHaveLength(2);
  });

  it("can create a new payment request for an expired invoice", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          pay_url: null,
          metadata: {
            payment_address: "NewSolAddress456",
            amount_crypto: "0.5",
            payment_currency: "SOL",
            expires_at: "2026-05-24T00:00:00Z",
          },
        },
      }),
    });

    render(
      <InvoicePaymentActions
        {...baseProps}
        status="expired"
        metadata={{
          payment_address: "OldSolAddress123",
          amount_crypto: "0.25",
          payment_currency: "SOL",
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /create new payment request/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/gigs/gig-1/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          application_id: "app-1",
          amount: 12,
          currency: "USD",
          notes: "Work completed",
          due_date: undefined,
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getAllByText("NewSolAddress456")).toHaveLength(2);
    });
    expect(screen.getByText("0.5 SOL")).toBeInTheDocument();
  });
});
