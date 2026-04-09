import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { findModel, DEFAULT_VIDEO_MODEL } from "@/lib/higgsfield-models";

const HIGGSFIELD_API    = process.env.HIGGSFIELD_API_URL ?? "https://platform.higgsfield.ai";
const HIGGSFIELD_KEY_ID = process.env.HIGGSFIELD_API_KEY_ID!;
const HIGGSFIELD_SECRET = process.env.HIGGSFIELD_API_KEY_SECRET!;

export async function POST(req: NextRequest) {
  const { genId } = await req.json() as { genId: string };
  if (!genId) return NextResponse.json({ error: "genId required" }, { status: 400 });

  const supabase = createServiceClient();

  const { data: gen } = await supabase
    .from("creative_generations")
    .select("id, prompt, model, status")
    .eq("id", genId)
    .single();

  if (!gen) return NextResponse.json({ error: "Generation not found" }, { status: 404 });
  if (!["error", "queued"].includes(gen.status as string)) {
    return NextResponse.json({ error: "Only error or stuck queued scenes can be retried" }, { status: 400 });
  }

  const slug = (gen.model as string) ?? DEFAULT_VIDEO_MODEL;
  const modelDef = findModel(slug);
  if (!modelDef) return NextResponse.json({ error: `Unknown model: ${slug}` }, { status: 400 });

  // Reset to queued while we submit — update created_at so the timeout clock restarts
  await supabase.from("creative_generations").update({
    status: "queued",
    higgsfield_job_id: null,
    error_message: null,
    result_url: null,
    created_at: new Date().toISOString(),
  }).eq("id", genId);

  try {
    const body = modelDef.buildBody(gen.prompt as string);
    const res = await fetch(`${HIGGSFIELD_API}/${slug}`, {
      method: "POST",
      headers: {
        "hf-api-key": HIGGSFIELD_KEY_ID,
        "hf-secret": HIGGSFIELD_SECRET,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      await supabase.from("creative_generations").update({
        status: "error",
        error_message: `Higgsfield ${res.status}: ${err.slice(0, 200)}`,
      }).eq("id", genId);
      return NextResponse.json({ error: `Higgsfield error ${res.status}` }, { status: 502 });
    }
    const data = await res.json() as { request_id: string };
    await supabase.from("creative_generations").update({
      status: "processing",
      higgsfield_job_id: data.request_id,
    }).eq("id", genId);

    return NextResponse.json({ ok: true, jobId: data.request_id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase.from("creative_generations").update({
      status: "error", error_message: msg,
    }).eq("id", genId);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
