import type { Command } from "commander";
import ora from "ora";
import { createClient, handleError, type GlobalOpts } from "../helpers.js";
import {
  printTable,
  printDetail,
  printSuccess,
  printError,
  type OutputOptions,
} from "../output.js";

type CoinpayWallet = {
  currency: string;
  address: string;
  label?: string | null;
  network?: string | null;
};

type WalletsResponse = {
  data: {
    wallets: CoinpayWallet[];
    oauth_required: boolean;
    setup_required: boolean;
    setup_instructions: string[];
  };
};

export function registerCoinpayCommands(program: Command): void {
  const coinpay = program
    .command("coinpay")
    .description("CoinPay wallet setup and global address management");

  // ── List global wallets from CoinPay ───────────────────────────

  coinpay
    .command("wallets")
    .description("List your CoinPay global wallet addresses")
    .action(async () => {
      const opts = program.opts() as GlobalOpts;
      const spinner = opts.json ? null : ora("Fetching CoinPay wallets...").start();
      try {
        const client = createClient(opts);
        const result = await client.get<WalletsResponse["data"]>("/api/coinpay/wallets");
        spinner?.stop();

        const data = (result as any).data ?? result;

        if (data.oauth_required) {
          printError(
            "CoinPay OAuth not connected. Connect your account at Settings > Connections in the ugig web app.",
            opts as OutputOptions
          );
          return;
        }

        if (data.setup_required || data.wallets.length === 0) {
          if (!opts.json) {
            console.log("\nNo global wallet addresses found. Setup steps:");
            (data.setup_instructions ?? []).forEach((step: string, i: number) => {
              console.log(`  ${i + 1}. ${step}`);
            });
            console.log();
          } else {
            console.log(JSON.stringify({ wallets: [], setup_instructions: data.setup_instructions }));
          }
          return;
        }

        printTable(
          [
            { header: "Currency", key: "currency", width: 12 },
            { header: "Network",  key: "network",  width: 12 },
            { header: "Label",    key: "label",    width: 16 },
            { header: "Address",  key: "address",  width: 48 },
          ],
          data.wallets,
          opts as OutputOptions
        );
      } catch (err) {
        spinner?.fail("Failed");
        handleError(err, opts as OutputOptions);
      }
    });

  // ── Import CoinPay global wallets → profile wallet_addresses ───

  coinpay
    .command("import")
    .description(
      "Import your CoinPay global wallet addresses into your ugig profile so posters can see them"
    )
    .option("--merge", "Merge with existing profile addresses instead of replacing them")
    .action(async (cmdOpts: { merge?: boolean }) => {
      const opts = program.opts() as GlobalOpts;
      const spinner = opts.json ? null : ora("Fetching CoinPay wallets...").start();
      try {
        const client = createClient(opts);
        const result = await client.get<WalletsResponse["data"]>("/api/coinpay/wallets");
        const data = (result as any).data ?? result;

        if (data.oauth_required) {
          spinner?.fail("Not connected");
          printError(
            "CoinPay OAuth not connected. Connect your account at Settings > Connections in the ugig web app.",
            opts as OutputOptions
          );
          return;
        }

        if (data.wallets.length === 0) {
          spinner?.fail("No wallets");
          printError(
            "No CoinPay global wallet addresses found. Add them in CoinPayPortal > Settings > Global Wallet Addresses.",
            opts as OutputOptions
          );
          return;
        }

        // Map CoinPay global wallets → profile wallet_addresses schema
        const incoming: { currency: string; address: string; is_preferred: boolean }[] =
          data.wallets.map((w: CoinpayWallet, i: number) => ({
            currency: w.currency,
            address: w.address,
            is_preferred: i === 0,
          }));

        let toSave = incoming;

        if (cmdOpts.merge) {
          if (spinner) spinner.text = "Merging with existing addresses...";
          const existing = await client.get<{
            poster_addresses: { currency: string; address: string; is_preferred: boolean }[];
          }>("/api/profile/wallet-addresses");
          const existingAddresses = (existing as any).poster_addresses ?? [];
          // Dedupe: incoming addresses override existing ones for the same currency
          const merged = [...existingAddresses];
          for (const addr of incoming) {
            const idx = merged.findIndex((a) => a.currency === addr.currency);
            if (idx >= 0) {
              merged[idx] = addr;
            } else {
              merged.push(addr);
            }
          }
          toSave = merged.slice(0, 20);
        }

        if (spinner) spinner.text = "Saving to profile...";
        await client.put("/api/profile/wallet-addresses", { wallet_addresses: toSave });
        spinner?.stop();

        printSuccess(
          `Imported ${toSave.length} wallet address${toSave.length !== 1 ? "es" : ""} to your profile`,
          opts as OutputOptions
        );
        printTable(
          [
            { header: "Currency",   key: "currency",     width: 12 },
            { header: "Preferred",  key: "is_preferred", width: 10 },
            { header: "Address",    key: "address",      width: 50 },
          ],
          toSave,
          opts as OutputOptions
        );
      } catch (err) {
        spinner?.fail("Failed");
        handleError(err, opts as OutputOptions);
      }
    });

  // ── Show setup status + instructions ──────────────────────────

  coinpay
    .command("setup")
    .description("Show CoinPay wallet setup status and instructions for invoicing")
    .action(async () => {
      const opts = program.opts() as GlobalOpts;
      const spinner = opts.json ? null : ora("Checking CoinPay status...").start();
      try {
        const client = createClient(opts);
        const result = await client.get<WalletsResponse["data"]>("/api/coinpay/wallets");
        const data = (result as any).data ?? result;
        spinner?.stop();

        if (opts.json) {
          console.log(JSON.stringify(data));
          return;
        }

        if (data.oauth_required) {
          console.log("\n⚠  CoinPay OAuth not connected.");
          console.log("   Connect at: Settings > Connections > CoinPay in the ugig web app.\n");
          return;
        }

        if (data.wallets.length === 0) {
          console.log("\n⚠  OAuth connected — no global wallet addresses found yet.");
          console.log("\nSetup steps:");
          data.setup_instructions?.forEach((step: string, i: number) => {
            console.log(`  ${i + 1}. ${step}`);
          });
          console.log("\nThen run: ugig coinpay import\n");
          return;
        }

        console.log(`\n✓  CoinPay connected — ${data.wallets.length} global address${data.wallets.length !== 1 ? "es" : ""} found.\n`);
        printTable(
          [
            { header: "Currency", key: "currency", width: 12 },
            { header: "Network",  key: "network",  width: 12 },
            { header: "Address",  key: "address",  width: 48 },
          ],
          data.wallets,
          opts as OutputOptions
        );
        console.log("\nRun `ugig coinpay import` to save these to your ugig profile.\n");
      } catch (err) {
        spinner?.fail("Failed");
        handleError(err, opts as OutputOptions);
      }
    });
}
