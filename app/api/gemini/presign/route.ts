import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

const BUCKET = "gemini-uploads";

export async function POST(req: NextRequest) {
  const { filename, contentType } = await req.json() as { filename: string; contentType: string };
  if (!filename) return NextResponse.json({ error: "filename required" }, { status: 400 });

  const supabase = createServiceClient();
  const path = `tmp/${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

  let { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);

  // Само-исцеление: бакет мог быть удалён/не создан → создаём public и пробуем ещё раз.
  if (error && !data) {
    await supabase.storage.createBucket(BUCKET, { public: true });
    ({ data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path));
  }

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Failed to create upload URL" }, { status: 500 });
  }

  const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

  return NextResponse.json({ signedUrl: data.signedUrl, path, publicUrl, token: data.token });
}
