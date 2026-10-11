import { createClerkClient } from "@clerk/backend";

import type { AuthenticatedIdentity, Env } from "./types";

function requiredHttpsOrigin(value: string, variable: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${variable} must be an HTTPS origin without a path`);
  }
  return url.origin;
}

export async function authenticateClerkRequest(
  request: Request,
  env: Env,
): Promise<AuthenticatedIdentity | null> {
  const appOrigin = requiredHttpsOrigin(env.APP_ORIGIN, "APP_ORIGIN");
  const clerk = createClerkClient({
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
    jwtKey: env.CLERK_JWT_KEY,
  });
  const state = await clerk.authenticateRequest(request, {
    authorizedParties: [appOrigin],
  });
  if (!state.isAuthenticated) {
    return null;
  }

  const auth = state.toAuth();
  const primaryEmail = auth.sessionClaims?.primaryEmail;
  if (typeof primaryEmail !== "string" || !primaryEmail.includes("@")) {
    return null;
  }
  return { subject: auth.userId, primaryEmail };
}

export function clerkFrontendOrigin(env: Env): string {
  return requiredHttpsOrigin(
    env.CLERK_FRONTEND_API_ORIGIN,
    "CLERK_FRONTEND_API_ORIGIN",
  );
}
