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
    const payload = JSON.parse(atob(token.split(".")[1]));
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
