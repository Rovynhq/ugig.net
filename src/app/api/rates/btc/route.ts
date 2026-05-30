import { NextResponse } from "next/server";
import { getBtcUsdRate } from "@/lib/rates";

export async function GET() {
  const rate = await getBtcUsdRate();
  return NextResponse.json({ rate });
}
