import { NextRequest, NextResponse } from "next/server";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/login") || pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const token = request.cookies.get("sb-access-token")?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url), { status: 302 });
  }

  try {
    // JWT payload — base64URL (символы - и _), а atob() понимает только обычный base64.
    // Без конвертации atob кидает InvalidCharacterError → юзера выбрасывало на /login,
    // хотя логин прошёл и токен валиден (зависело от того, есть ли -/_ в payload).
    const seg = (token.split(".")[1] ?? "").replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(seg + "=".repeat((4 - (seg.length % 4)) % 4)));
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      return NextResponse.redirect(new URL("/login", request.url), { status: 302 });
    }
  } catch {
    return NextResponse.redirect(new URL("/login", request.url), { status: 302 });
  }

  return NextResponse.next();
}

export const proxyConfig = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|api).*)"],
};
