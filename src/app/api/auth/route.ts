import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE_NAME, hashPassword, isAuthEnabled } from "@/lib/auth";

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

  try {
    const body = await req.json();
    const password = typeof body.password === "string" ? body.password.trim() : "";
    const expected = process.env.ACCESS_PASSWORD?.trim() || "";

    if (password !== expected) {
      return NextResponse.json({ success: false, error: "Incorrect access password." }, { status: 401 });
    }

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
  } catch (err) {
    return NextResponse.json({ success: false, error: "Invalid request payload." }, { status: 400 });
  }
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(AUTH_COOKIE_NAME);
  return NextResponse.json({ success: true });
}
