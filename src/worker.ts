import { appOrigin, authenticateClerkRequest, clerkFrontendOrigin } from "./auth";
import { isAuthorized, resolveMember } from "./authorization";
import { handlePerformanceApi, purgeExpiredInactivePerformances } from "./performances";
import { handlePersonalRecordingApi, purgeExpiredPersonalRecordings } from "./recordings";
import { handleProgressApi, purgeExpiredPracticeAttempts } from "./progress";
import { handleEchoDiagnosticApi, purgeExpiredEchoDiagnostics } from "./echo_diagnostics";
import type { Env, RequestAuthenticator } from "./types";

const PUBLIC_PATHS = new Set([
  "/auth-client.js",
  "/auth/config",
  "/not-authorized",
  "/not-authorized.html",
  "/sign-in",
  "/sign-in.html",
  "/sign-up",
  "/sign-up.html",
  "/sign-out",
  "/sign-out.html",
]);
const PUBLIC_AUTH_STYLE = /^\/auth\.[a-f0-9]{12}\.css$/;
const PUBLIC_STARTUP_CODE = /^\/(?:auth-client\.[a-f0-9]{12}\.js|startup\.[a-f0-9]{12}\.(?:js|css))$/;
const VERSIONED_CODE = /^\/[a-zA-Z0-9_-]+\.[a-f0-9]{12}\.(?:js|css)$/;

function codeCache(pathname: string, response: Response, isPublic = false): string | null {
  if (![200, 304].includes(response.status)) return null;
  if (VERSIONED_CODE.test(pathname)) {
    return `${isPublic ? 'public' : 'private'}, max-age=31536000, immutable`;
  }
  if (pathname === '/auth-client.js' || pathname === '/session-client.js') {
    return `${isPublic ? 'public' : 'private'}, no-cache`;
  }
  return null;
}

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || PUBLIC_AUTH_STYLE.test(pathname) || PUBLIC_STARTUP_CODE.test(pathname);
}

const SECURITY_HEADERS: Record<string, string> = {
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

function withHeaders(response: Response, headers: Record<string, string>): Response {
  const next = new Headers(response.headers);
  for (const [name, value] of Object.entries(headers)) next.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: next,
  });
}

function signInCsp(frontendOrigin: string): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `connect-src 'self' ${frontendOrigin} https://*.protect.clerk.com:*`,
    "img-src 'self' data: https://img.clerk.com",
    `script-src 'self' ${frontendOrigin} https://challenges.cloudflare.com https://*.protect.clerk.com`,
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
    "frame-src https://challenges.cloudflare.com https://*.protect.clerk.com",
  ].join("; ");
}

function safeReturnPath(request: Request): string {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
}

function unauthenticated(request: Request): Response {
  const acceptsHtml = request.headers.get("Accept")?.includes("text/html") ?? false;
  const isNavigation = request.method === "GET" && acceptsHtml;
  if (isNavigation) {
    const location = `/sign-in?return_url=${encodeURIComponent(safeReturnPath(request))}`;
    return new Response(null, {
      status: 302,
      headers: { Location: location, "Cache-Control": "no-store" },
    });
  }
  return Response.json(
    { error: "authentication_required" },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}

function forbiddenJson(): Response {
  return Response.json(
    { error: "not_authorized" },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}

function unavailable(error: string): Response {
  return Response.json(
    { error },
    {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "30" },
    },
  );
}

function safeAuthenticationError(error: unknown): { errorName: string; message: string } {
  if (!(error instanceof Error)) {
    return { errorName: "NonError", message: "Unknown authentication failure" };
  }
  const message = error.message
    .replace(/(?:pk|sk)_(?:test|live)_[A-Za-z0-9_-]+/g, "[redacted-key]")
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, "[redacted-jwt]")
    .slice(0, 300);
  return { errorName: error.name, message };
}

async function forbidden(request: Request, env: Env): Promise<Response> {
  const acceptsHtml = request.headers.get("Accept")?.includes("text/html") ?? false;
  if (request.method !== "GET" || !acceptsHtml) return forbiddenJson();
  // Use the canonical extensionless URL expected by Cloudflare's default
  // static-assets HTML handling. Fetching the .html path yields a 307.
  const url = new URL("/not-authorized", request.url);
  const page = await env.ASSETS.fetch(new Request(url, request));
  const headers = new Headers(page.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Security-Policy", signInCsp(clerkFrontendOrigin(env)));
  return new Response(page.body, { status: 403, headers });
}

async function servePublic(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/auth/config") {
    return Response.json(
      { publishableKey: env.CLERK_PUBLISHABLE_KEY },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  // Keep canonical extensionless paths unchanged. With the default
  // auto-trailing-slash HTML handling, /sign-in serves sign-in.html while an
  // explicit /sign-in.html request redirects to /sign-in. The same applies to
  // the local first-access page at /sign-up.
  let response = await env.ASSETS.fetch(request);
  const cache = codeCache(url.pathname, response, true);
  if (cache) response = withHeaders(response, { 'Cache-Control': cache });
  if ([
    "/sign-in",
    "/sign-in.html",
    "/sign-up",
    "/sign-up.html",
    "/sign-out",
    "/sign-out.html",
    "/not-authorized",
    "/not-authorized.html",
  ].includes(url.pathname)) {
    response = withHeaders(response, {
      "Cache-Control": "no-store",
      "Content-Security-Policy": signInCsp(clerkFrontendOrigin(env)),
    });
  }
  return response;
}

export function createWorker(authenticate: RequestAuthenticator = authenticateClerkRequest) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);
      let expectedOrigin: string;
      try {
        expectedOrigin = appOrigin(env);
      } catch {
        return withHeaders(unavailable("configuration_unavailable"), SECURITY_HEADERS);
      }
      if (url.origin !== expectedOrigin) {
        return withHeaders(
          Response.json(
            { error: "misdirected_request" },
            { status: 421, headers: { "Cache-Control": "no-store" } },
          ),
          SECURITY_HEADERS,
        );
      }
      if (isPublicPath(url.pathname)) {
        return withHeaders(await servePublic(request, env), SECURITY_HEADERS);
      }

      let authentication;
      try {
        authentication = await authenticate(request, env);
      } catch (error) {
        console.error(JSON.stringify({
          event: "clerk_auth_exception",
          ...safeAuthenticationError(error),
        }));
        return withHeaders(unauthenticated(request), SECURITY_HEADERS);
      }
      if (authentication instanceof Response) {
        return withHeaders(authentication, SECURITY_HEADERS);
      }
      const identity = authentication;
      if (!identity) return withHeaders(unauthenticated(request), SECURITY_HEADERS);

      try {
        if (!(await isAuthorized(identity, env))) {
          console.warn(JSON.stringify({ event: "member_allowlist_rejected" }));
          return withHeaders(await forbidden(request, env), SECURITY_HEADERS);
        }
      } catch {
        console.error(JSON.stringify({ event: "member_allowlist_unavailable" }));
        return withHeaders(unavailable("authorization_unavailable"), SECURITY_HEADERS);
      }

      if (url.pathname.startsWith("/api/")) {
        if (!["GET", "HEAD"].includes(request.method)) {
          const origin = request.headers.get("Origin");
          if (origin !== expectedOrigin) {
            return withHeaders(forbiddenJson(), SECURITY_HEADERS);
          }
        }
        try {
          const member = await resolveMember(identity, env);
          if (!member) return withHeaders(await forbidden(request, env), SECURITY_HEADERS);
          const diagnosticResponse = await handleEchoDiagnosticApi(request, env, member);
          const recordingResponse = diagnosticResponse ?? await handlePersonalRecordingApi(request, env, member);
          const progressResponse = recordingResponse ?? await handleProgressApi(request, env, member);
          return withHeaders(progressResponse ?? await handlePerformanceApi(request, env, member), SECURITY_HEADERS);
        } catch {
          return withHeaders(unavailable("performance_unavailable"), SECURITY_HEADERS);
        }
      }

      const asset = await env.ASSETS.fetch(request);
      const cache = codeCache(url.pathname, asset);
      return withHeaders(asset, {
        ...SECURITY_HEADERS,
        "Cache-Control": cache ?? "private, no-store",
        "Vary": cache ? (asset.headers.get('Vary') ?? 'Accept-Encoding') : "Cookie, Authorization",
      });
    },
    async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
      ctx.waitUntil(Promise.all([
        purgeExpiredInactivePerformances(env),
        purgeExpiredPersonalRecordings(env),
        purgeExpiredPracticeAttempts(env),
        purgeExpiredEchoDiagnostics(env),
      ]).then(() => undefined));
    },
  };
}

export default createWorker();
