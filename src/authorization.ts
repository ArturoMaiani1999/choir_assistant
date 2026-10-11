import type { AuthenticatedIdentity, Env } from "./types";

const encoder = new TextEncoder();

export function normalizeEmail(email: string): string {
  return email.trim().normalize("NFKC").toLowerCase();
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function emailDigest(email: string, secret: string): Promise<string> {
  if (secret.length < 32) {
    throw new Error("AUTH_EMAIL_HMAC_KEY must contain at least 32 characters");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(
    await crypto.subtle.sign("HMAC", key, encoder.encode(normalizeEmail(email))),
  );
}

export async function isAuthorized(
  identity: AuthenticatedIdentity,
  env: Env,
): Promise<boolean> {
  const digest = await emailDigest(identity.primaryEmail, env.AUTH_EMAIL_HMAC_KEY);
  const row = await env.AUTH_DB.prepare(
    "SELECT active FROM authorized_members WHERE email_digest = ?1 LIMIT 1",
  )
    .bind(digest)
    .first<{ active: number }>();
  return row?.active === 1;
}
