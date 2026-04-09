import { NextRequest, NextResponse } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const email = (form.get("email") as string ?? "").trim();
  const password = form.get("password") as string ?? "";

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
    const msg = data.error_description ?? "Неверный email или пароль";
    const response = NextResponse.redirect(new URL("/login", req.url), { status: 302 });
    response.cookies.set("sb-login-error", msg, { path: "/", maxAge: 10, sameSite: "lax" });
    return response;
  }

  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const greeting = data.user?.user_metadata?.greeting ?? "Добро пожаловать!";

  const response = NextResponse.redirect(new URL("/login", req.url), { status: 302 });
  response.cookies.set("sb-access-token", data.access_token, { path: "/", expires, sameSite: "lax", httpOnly: false });
  response.cookies.set("sb-greeting", greeting, { path: "/", maxAge: 30, sameSite: "lax" });
  if (data.refresh_token) {
    response.cookies.set("sb-refresh-token", data.refresh_token, { path: "/", expires, sameSite: "lax", httpOnly: true });
  }
  return response;
}
