import { NextRequest } from "next/server";
import { POST as ellySyncPost } from "@/app/api/pbi/elly-sync/route";

// CRM-синк Google (лиды/QL/выручка из Elly, source=google) — отдельный канал,
// отдельный путь без query-string (надёжно для Vercel cron). Дёргает elly-sync
// с source=google. Спенд Google тянет /api/google/sync; этот роут — про CRM.
export const maxDuration = 300;

export async function POST() {
  return ellySyncPost(new NextRequest("http://localhost/api/pbi/elly-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "google" }),
  }));
}

export async function GET() {
  return POST();
}
