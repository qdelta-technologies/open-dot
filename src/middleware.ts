import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE_NAME, hashPassword, isAuthEnabled } from "@/lib/auth";

export async function middleware(request: NextRequest) {
  if (!isAuthEnabled()) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  const rawExpected = process.env.ACCESS_PASSWORD?.trim() || "";
  const expectedToken = await hashPassword(rawExpected);
  const sessionCookie = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const isAuthenticated = sessionCookie === expectedToken;

  // If visiting /login, auth API, Composio OAuth callback, or PWA assets
  if (
    pathname === "/login" ||
    pathname.startsWith("/api/auth") ||
    pathname === "/api/composio/oauth" ||
    pathname.startsWith("/api/public-files/") ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js"
  ) {
    if (pathname === "/login" && isAuthenticated) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  // If not authenticated
  if (!isAuthenticated) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized. ACCESS_PASSWORD required." }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/") {
      loginUrl.searchParams.set("from", pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2|ico|webmanifest)$).*)",
  ],
};
