import { NextResponse } from "next/server";
import { getPlatforms } from "@/lib/platforms";

// Статус подключённых рекламных платформ (Meta — рабочая, TikTok — каркас).
export function GET() {
  return NextResponse.json({ platforms: getPlatforms() });
}
