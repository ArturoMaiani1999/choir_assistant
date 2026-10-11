import { authenticateClerkRequest, clerkFrontendOrigin } from "./auth";
import { isAuthorized } from "./authorization";
import type { Env, RequestAuthenticator } from "./types";

const PUBLIC_PATHS = new Set([
  "/auth-client.js",
  "/auth/config",
  "/not-authorized.html",
  "/sign-in",
  "/sign-in.html",
]);

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

async function forbidden(request: Request, env: Env): Promise<Response> {
  const acceptsHtml = request.headers.get("Accept")?.includes("text/html") ?? false;
  if (request.method !== "GET" || !acceptsHtml) return forbiddenJson();
  const url = new URL("/not-authorized.html", request.url);
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
  if (url.pathname === "/sign-in") {
    url.pathname = "/sign-in.html";
    request = new Request(url, request);
  }
  let response = await env.ASSETS.fetch(request);
  if (url.pathname === "/sign-in.html" || url.pathname === "/not-authorized.html") {
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
      if (PUBLIC_PATHS.has(url.pathname)) {
        return withHeaders(await servePublic(request, env), SECURITY_HEADERS);
      }

      let identity;
      try {
        identity = await authenticate(request, env);
      } catch {
        return withHeaders(unauthenticated(request), SECURITY_HEADERS);
      }
      if (!identity) return withHeaders(unauthenticated(request), SECURITY_HEADERS);

      try {
        if (!(await isAuthorized(identity, env))) {
          return withHeaders(await forbidden(request, env), SECURITY_HEADERS);
        }
      } catch {
        return withHeaders(
          Response.json(
            { error: "authorization_unavailable" },
            { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } },
          ),
          SECURITY_HEADERS,
        );
      }

      const asset = await env.ASSETS.fetch(request);
      return withHeaders(asset, {
        ...SECURITY_HEADERS,
        "Cache-Control": "private, no-store",
        "Vary": "Cookie, Authorization",
      });
    },
  };
}

export default createWorker();
