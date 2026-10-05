export const AUTH_COOKIE_NAME = "opendot_session";

/** Hashes the password with SHA-256 using standard Web Crypto API. */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`opendot-auth-v1:${password}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Returns true if ACCESS_PASSWORD is set and non-empty. */
export function isAuthEnabled(): boolean {
  const pwd = process.env.ACCESS_PASSWORD;
  return Boolean(pwd && pwd.trim().length > 0);
}
