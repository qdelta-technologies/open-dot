import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DATA_DIR } from "./db";
import { insertPassword, sealedPasswordFor } from "./repo";

// Passwords are AES-256-GCM encrypted at rest. The master key lives in the macOS
// Keychain when available, Windows DPAPI on Windows, otherwise in a 0600 file under .data/. Plaintext secrets
// are only ever decrypted to type them into a page — never returned to the model or UI.

const SERVICE = "dots-openai-vault";
const g = globalThis as unknown as { __dotsVaultKey?: Buffer };

function dpapiProtect(plain: string): string {
  const script = `
$raw = [Console]::In.ReadToEnd().Trim()
Add-Type -AssemblyName System.Security
$bytes = [System.Text.Encoding]::UTF8.GetBytes($raw)
$enc = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($enc))
`;
  return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    input: plain,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "ignore"],
  }).trim();
}

function dpapiUnprotect(b64: string): string {
  const script = `
$b64 = [Console]::In.ReadToEnd().Trim()
Add-Type -AssemblyName System.Security
$bytes = [Convert]::FromBase64String($b64)
$dec = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($dec))
`;
  return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    input: b64,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "ignore"],
  }).trim();
}

function masterKey(): Buffer {
  if (g.__dotsVaultKey) return g.__dotsVaultKey;
  let hex: string | null = null;
  if (process.platform === "darwin") {
    try {
      hex = execFileSync("security", ["find-generic-password", "-s", SERVICE, "-a", "master", "-w"], { stdio: ["ignore", "pipe", "ignore"] })
        .toString().trim();
    } catch {
      hex = crypto.randomBytes(32).toString("hex");
      try {
        execFileSync("security", ["add-generic-password", "-s", SERVICE, "-a", "master", "-w", hex, "-U"], { stdio: "ignore" });
      } catch {
        hex = null;
      }
    }
  } else if (process.platform === "win32") {
    const dpapiFile = path.join(DATA_DIR, "vault.dpapi");
    const legacyFile = path.join(DATA_DIR, "vault.key");
    fs.mkdirSync(DATA_DIR, { recursive: true });

    // 1. Existing DPAPI-protected key
    if (fs.existsSync(dpapiFile)) {
      try {
        const b64 = fs.readFileSync(dpapiFile, "utf8").trim();
        const recovered = dpapiUnprotect(b64);
        if (recovered && /^[0-9a-fA-F]{64}$/.test(recovered)) {
          hex = recovered;
        }
      } catch (err) {
        console.error("[vault] Failed to unprotect Windows DPAPI vault key:", err instanceof Error ? err.message : String(err));
      }
    }

    // 2. Safe one-time migration from existing plaintext vault.key
    if (!hex && fs.existsSync(legacyFile)) {
      try {
        const legacyHex = fs.readFileSync(legacyFile, "utf8").trim();
        if (legacyHex && /^[0-9a-fA-F]{64}$/.test(legacyHex)) {
          const enc = dpapiProtect(legacyHex);
          const verify = dpapiUnprotect(enc);
          if (verify === legacyHex) {
            fs.writeFileSync(dpapiFile, enc, "utf8");
            fs.rmSync(legacyFile, { force: true });
            hex = legacyHex;
          }
        }
      } catch (err) {
        console.error("[vault] Windows DPAPI migration failed:", err instanceof Error ? err.message : String(err));
      }
    }

    // 3. New DPAPI-protected key
    if (!hex) {
      try {
        const newHex = crypto.randomBytes(32).toString("hex");
        const enc = dpapiProtect(newHex);
        const verify = dpapiUnprotect(enc);
        if (verify === newHex) {
          fs.writeFileSync(dpapiFile, enc, "utf8");
          hex = newHex;
        }
      } catch (err) {
        console.error("[vault] Failed to initialize Windows DPAPI vault key:", err instanceof Error ? err.message : String(err));
      }
    }
  }

  // Linux or fallback if secure storage failed
  if (!hex) {
    const file = path.join(DATA_DIR, "vault.key");
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
    hex = fs.readFileSync(file, "utf8").trim();
  }
  g.__dotsVaultKey = Buffer.from(hex, "hex");
  return g.__dotsVaultKey;
}

/** Encrypt any secret with the vault key (also used for Composio OAuth tokens). */
export function seal(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

export function unseal(sealed: string): string {
  const [iv, tag, data] = sealed.split(".").map((s) => Buffer.from(s, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function savePassword(site: string, username: string, password: string) {
  return insertPassword(site.trim(), username.trim(), seal(password));
}

export function credentialFor(site: string): { site: string; username: string; password: string } | null {
  const row = sealedPasswordFor(site);
  return row ? { site: row.site, username: row.username, password: unseal(row.sealed) } : null;
}
