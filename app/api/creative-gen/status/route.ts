import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

const HIGGSFIELD_API    = process.env.HIGGSFIELD_API_URL ?? "https://platform.higgsfield.ai";
const HIGGSFIELD_KEY_ID = process.env.HIGGSFIELD_API_KEY_ID!;
const HIGGSFIELD_SECRET = process.env.HIGGSFIELD_API_KEY_SECRET!;
async function pollHiggsfield(requestId: string) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  let res: Response;
  try {
    res = await fetch(`${HIGGSFIELD_API}/requests/${requestId}/status`, {
      headers: {
        "hf-api-key": HIGGSFIELD_KEY_ID,
        "hf-secret": HIGGSFIELD_SECRET,
        "Accept": "application/json",
      },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 404) throw new Error("expired");
  if (!res.ok) throw new Error(`Poll error ${res.status}: ${await res.text().catch(() => "")}`);

  return res.json() as Promise<{
    request_id: string;
    status: string;
    image?: { url: string };
    images?: { url: string }[];
    video?: { url: string };
    videos?: { url: string }[];
    error?: string;
  }>;
}

// GET /api/creative-gen/status?id={generationId}
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const supabase = createServiceClient();

  const { data: gen } = await supabase
    .from("creative_generations").select("*").eq("id", id).single();

  if (!gen) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (gen.status === "done" || gen.status === "error") {
    return NextResponse.json({ ok: true, generation: gen });
  }

  if (gen.higgsfield_job_id) {
    let job: Awaited<ReturnType<typeof pollHiggsfield>> | null = null;
    let pollError: string | null = null;
    try {
      job = await pollHiggsfield(gen.higgsfield_job_id as string);

      const resultUrl = job.image?.url ?? job.images?.[0]?.url ?? job.video?.url ?? job.videos?.[0]?.url ?? null;
      if (job.status === "completed" && resultUrl) {
        await supabase.from("creative_generations").update({
          status: "done", result_url: resultUrl,
        }).eq("id", id);
        return NextResponse.json({ ok: true, generation: { ...gen, status: "done", result_url: resultUrl }, _hf: job });
      }

      if (job.status === "failed") {
        const errorMsg = job.error || `Higgsfield failed (no details). Full response: ${JSON.stringify(job)}`;
        await supabase.from("creative_generations").update({
          status: "error", error_message: errorMsg,
        }).eq("id", id);
        return NextResponse.json({ ok: true, generation: { ...gen, status: "error", error_message: errorMsg }, _hf: job });
      }
    } catch (e) {
      pollError = e instanceof Error ? e.message : String(e);
      if (pollError === "expired") {
        const errMsg = "Job expired on Higgsfield (404)";
        await supabase.from("creative_generations").update({
          status: "error", error_message: errMsg,
        }).eq("id", id);
        return NextResponse.json({ ok: true, generation: { ...gen, status: "error", error_message: errMsg }, _hf_error: pollError });
      }
    }
    return NextResponse.json({ ok: true, generation: gen, _hf: job, _hf_error: pollError });
  }

  return NextResponse.json({ ok: true, generation: gen });
}
