import { NextRequest, NextResponse } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const email = (form.get("email") as string ?? "").trim();
  const password = form.get("password") as string ?? "";

  if (!email || !password) {
    return NextResponse.redirect(new URL("/login?error=empty", req.url));
  }

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json() as {
    access_token?: string;
    refresh_token?: string;
    user?: { user_metadata?: { greeting?: string } };
    error_description?: string;
  };

  if (!res.ok || !data.access_token) {
    const msg = encodeURIComponent(data.error_description ?? "Неверный email или пароль");
    return NextResponse.redirect(new URL(`/login?error=${msg}`, req.url));
  }

  const greeting = encodeURIComponent(data.user?.user_metadata?.greeting ?? "Добро пожаловать!");
  const response = NextResponse.redirect(new URL(`/login?greeting=${greeting}`, req.url));

  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  response.cookies.set("sb-access-token", data.access_token, { path: "/", expires, sameSite: "lax", httpOnly: false });
  if (data.refresh_token) {
    response.cookies.set("sb-refresh-token", data.refresh_token, { path: "/", expires, sameSite: "lax", httpOnly: true });
  }

  return response;
}
