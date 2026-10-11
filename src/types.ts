export interface Env {
  ASSETS: Fetcher;
  AUTH_DB: D1Database;
  APP_ORIGIN: string;
  AUTH_EMAIL_HMAC_KEY: string;
  CLERK_FRONTEND_API_ORIGIN: string;
  CLERK_JWT_KEY: string;
  CLERK_PUBLISHABLE_KEY: string;
}

export interface AuthenticatedIdentity {
  subject: string;
  primaryEmail: string;
}

export type RequestAuthenticator = (
  request: Request,
  env: Env,
) => Promise<AuthenticatedIdentity | null>;
