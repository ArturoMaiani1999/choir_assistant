import { createClerkClient } from "@clerk/backend";

import { normalizeEmail } from "./authorization";
import type { AuthenticatedIdentity, Env } from "./types";

function requiredHttpsOrigin(value: string, variable: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error(`${variable} must be an HTTPS origin without a path`);
  }
  return url.origin;
}

export function appOrigin(env: Env): string {
  return requiredHttpsOrigin(env.APP_ORIGIN, "APP_ORIGIN");
}

export function identityFromSessionClaims(
  subject: unknown,
  claims: unknown,
): AuthenticatedIdentity | null {
  if (typeof subject !== "string" || !subject) return null;
  if (!claims || typeof claims !== "object") return null;

  const values = claims as Record<string, unknown>;
  // Clerk marks impersonated sessions with an actor claim. They are useful for
  // support, but must not grant access to private choir material.
  if (values.act != null) return null;

  const primaryEmail = values.primaryEmail;
  if (typeof primaryEmail !== "string") return null;
  const normalized = normalizeEmail(primaryEmail);
  if (
    normalized.length > 254 ||
    !/^[^\s@]+@[^\s@]+$/.test(normalized)
  ) {
    return null;
  }
  return { subject, primaryEmail: normalized };
}

export async function authenticateClerkRequest(
  request: Request,
  env: Env,
): Promise<AuthenticatedIdentity | null> {
  const expectedOrigin = appOrigin(env);
  const clerk = createClerkClient({
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
    jwtKey: env.CLERK_JWT_KEY,
  });
  const state = await clerk.authenticateRequest(request, {
    authorizedParties: [expectedOrigin],
  });
  if (!state.isAuthenticated) {
    return null;
  }

  const auth = state.toAuth();
  return identityFromSessionClaims(auth.userId, auth.sessionClaims);
}

export function clerkFrontendOrigin(env: Env): string {
  return requiredHttpsOrigin(
    env.CLERK_FRONTEND_API_ORIGIN,
    "CLERK_FRONTEND_API_ORIGIN",
  );
}
