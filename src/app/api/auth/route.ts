import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE_NAME, hashPassword, isAuthEnabled } from "@/lib/auth";
import { checkRateLimit, getRequestIp, recordFailedAttempt, resetRateLimit } from "@/lib/rateLimit";

export async function GET() {
  if (!isAuthEnabled()) {
    return NextResponse.json({ enabled: false, authenticated: true });
  }

  const cookieStore = await cookies();
  const session = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const rawExpected = process.env.ACCESS_PASSWORD?.trim() || "";
  const expectedToken = await hashPassword(rawExpected);

  return NextResponse.json({
    enabled: true,
    authenticated: session === expectedToken,
  });
}

export async function POST(req: NextRequest) {
  if (!isAuthEnabled()) {
    return NextResponse.json({ success: true });
  }

  const clientIp = getRequestIp(req);
  const rateLimit = checkRateLimit(clientIp);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: `Too many failed attempts. Please wait ${rateLimit.waitMinutes || 15} minute(s) before trying again.`,
      },
      { status: 429 }
    );
  }

  try {
    const body = await req.json();
    const password = typeof body.password === "string" ? body.password.trim() : "";
    const expected = process.env.ACCESS_PASSWORD?.trim() || "";

    if (password !== expected) {
      const { remaining } = recordFailedAttempt(clientIp);
      const errorMsg =
        remaining === 0
          ? "Too many failed attempts. Access locked for 15 minutes."
          : `Incorrect access password. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`;
      return NextResponse.json({ success: false, error: errorMsg }, { status: 401 });
    }

    // Success: clear failed attempts
    resetRateLimit(clientIp);

    const hash = await hashPassword(expected);
    const cookieStore = await cookies();
    cookieStore.set(AUTH_COOKIE_NAME, hash, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request payload." }, { status: 400 });
  }
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(AUTH_COOKIE_NAME);
  return NextResponse.json({ success: true });
}
