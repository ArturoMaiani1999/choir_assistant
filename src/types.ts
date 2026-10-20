export interface Env {
  ASSETS: Fetcher;
  AUTH_DB: D1Database;
  PERFORMANCE_BUCKET?: R2Bucket;
  APP_ORIGIN: string;
  AUTH_EMAIL_HMAC_KEY: string;
  CLERK_FRONTEND_API_ORIGIN: string;
  CLERK_JWT_KEY: string;
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
}

export type ChoirRole = "singer" | "section_viewer" | "director" | "admin";
export type VoicePart = "soprano" | "contralto" | "tenore" | "basso";

export interface MemberContext {
  memberId: string;
  choirId: string;
  displayName: string;
  firstName?: string | null;
  lastName?: string | null;
  profileCompleted?: boolean;
  voicePart: VoicePart | null;
  preferredVoicePart?: VoicePart | null;
  roles: ChoirRole[];
  groupIds: string[];
  viewableGroupIds: string[];
}

export interface AuthenticatedIdentity {
  subject: string;
  primaryEmail: string;
}

export type RequestAuthenticator = (
  request: Request,
  env: Env,
) => Promise<AuthenticatedIdentity | Response | null>;
