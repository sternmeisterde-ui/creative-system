import { NextRequest, NextResponse } from "next/server";

// Next.js 16 proxy (бывший middleware) — гейт авторизации.
// Куки: sb-access-token (JWT, exp ~1ч у Supabase) + sb-refresh-token (long-lived).
// Раньше сессия «умирала» на каждом рефреше по двум причинам:
//  1) экспорт назывался proxyConfig — Next 16 ждёт `config`, поэтому matcher
//     игнорировался и гейт крутился даже на _next/static → протухший токен
//     редиректил ассеты на /login и ломал страницу;
//  2) refresh-токен никто не использовал → после протухания access-токена (~1ч)
//     юзера выбрасывало, без тихого обновления.
// Теперь: matcher работает, а истёкший/скоро-истекающий токен тихо обновляется
// по refresh-токену со скользящим окном 7 дней → авторизация постоянная.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60;   // 7 дней (скользящее окно)
const REFRESH_SKEW_MS = 5 * 60 * 1000;     // обновляем за 5 мин до протухания

function tokenExpMs(token: string): number | null {
  try {
    // JWT payload — base64url; Buffer('base64url') в Node-рантайме proxy читает его напрямую.
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function setSession(res: NextResponse, accessToken: string, refreshToken?: string) {
  res.cookies.set("sb-access-token", accessToken, { path: "/", maxAge: COOKIE_MAX_AGE, sameSite: "lax", httpOnly: false });
  if (refreshToken) {
    res.cookies.set("sb-refresh-token", refreshToken, { path: "/", maxAge: COOKIE_MAX_AGE, sameSite: "lax", httpOnly: true });
  }
}

function toLogin(request: NextRequest): NextResponse {
  const res = NextResponse.redirect(new URL("/login", request.url), { status: 302 });
  res.cookies.delete("sb-access-token");
  res.cookies.delete("sb-refresh-token");
  return res;
}

async function refreshSession(refreshToken: string): Promise<{ accessToken: string; refreshToken: string } | null> {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!r.ok) return null;
    const d = await r.json() as { access_token?: string; refresh_token?: string };
    if (!d.access_token || !d.refresh_token) return null;
    return { accessToken: d.access_token, refreshToken: d.refresh_token };
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/login") || pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const accessToken = request.cookies.get("sb-access-token")?.value;
  const refreshToken = request.cookies.get("sb-refresh-token")?.value;
  const exp = accessToken ? tokenExpMs(accessToken) : null;
  const stillFresh = exp != null && exp - REFRESH_SKEW_MS > Date.now();

  // Токен свежий — пускаем, попутно продлеваем скользящую куку (не даём ей истечь).
  if (accessToken && stillFresh) {
    const res = NextResponse.next();
    setSession(res, accessToken);
    return res;
  }

  // Нет токена / истёк / скоро истечёт — тихо обновляем по refresh-токену.
  if (refreshToken) {
    const renewed = await refreshSession(refreshToken);
    if (renewed) {
      const res = NextResponse.next();
      setSession(res, renewed.accessToken, renewed.refreshToken);
      return res;
    }
  }

  return toLogin(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|api).*)"],
};
