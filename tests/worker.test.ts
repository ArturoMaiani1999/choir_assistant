import { describe, expect, it } from "vitest";

import { identityFromSessionClaims } from "../src/auth";
import { emailDigest, normalizeEmail } from "../src/authorization";
import type { AuthenticatedIdentity, Env, RequestAuthenticator } from "../src/types";
import { createWorker } from "../src/worker";
import { safeReturnPath } from "../frontend/auth-url";

const SECRET = "test-only-secret-with-at-least-32-characters";
const IDENTITY: AuthenticatedIdentity = {
  subject: "user_test",
  primaryEmail: "Singer@Example.org",
};

function fakeEnv(options: { active?: boolean; dbError?: boolean } = {}): Env {
  const assets = {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (request.headers.get("Range")) {
        return new Response("part", {
          status: 206,
          headers: { "Content-Range": "bytes 0-3/10" },
        });
      }
      return new Response(`asset:${url.pathname}`, {
        headers: { "Cache-Control": "public, max-age=3600", "Content-Type": "text/plain" },
      });
    },
  } as Fetcher;
  const database = {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              if (options.dbError) throw new Error("database unavailable");
              return options.active === false ? { active: 0 } : { active: 1 };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return {
    APP_ORIGIN: "https://choir.example.org",
    ASSETS: assets,
    AUTH_DB: database,
    AUTH_EMAIL_HMAC_KEY: SECRET,
    CLERK_FRONTEND_API_ORIGIN: "https://clerk.choir.example.org",
    CLERK_JWT_KEY: "test-public-jwt-verification-key",
    CLERK_PUBLISHABLE_KEY: "pk_test_not-a-secret",
  };
}

const authenticated: RequestAuthenticator = async () => IDENTITY;
const anonymous: RequestAuthenticator = async () => null;

describe("email authorization", () => {
  it("normalizes case, whitespace, and Unicode compatibility characters", () => {
    expect(normalizeEmail("  SINGER＠EXAMPLE.ORG ")).toBe("singer@example.org");
  });

  it("produces the same digest for normalized variants", async () => {
    await expect(emailDigest("Singer@Example.org", SECRET)).resolves.toBe(
      await emailDigest(" singer@example.org ", SECRET),
    );
  });

  it("rejects weak HMAC secrets", async () => {
    await expect(emailDigest("singer@example.org", "short")).rejects.toThrow(/32/);
  });

  it("accepts and normalizes the signed primary email claim", () => {
    expect(identityFromSessionClaims("user_test", {
      primaryEmail: " Singer\uff20Example.org ",
    })).toEqual({ subject: "user_test", primaryEmail: "singer@example.org" });
  });

  it("rejects missing, malformed, or impersonated identity claims", () => {
    expect(identityFromSessionClaims("user_test", {})).toBeNull();
    expect(identityFromSessionClaims("user_test", { primaryEmail: "not-an-email" })).toBeNull();
    expect(identityFromSessionClaims("user_test", {
      primaryEmail: "singer@example.org",
      act: { sub: "admin_test" },
    })).toBeNull();
  });
});

describe("post-authentication return URL", () => {
  const origin = "https://choir.example.org";

  it.each([
    "https://attacker.example/path",
    "//attacker.example/path",
    "/\\attacker.example/path",
    "/auth/config",
    "/sign-in",
  ])("rejects unsafe target %s", (target) => {
    expect(safeReturnPath(target, origin)).toBe("/");
  });

  it("retains a same-origin path, query, and fragment", () => {
    expect(safeReturnPath("/library?piece=x#measure-2", origin)).toBe(
      "/library?piece=x#measure-2",
    );
  });
});

describe("edge authorization", () => {
  it("rejects alternate hostnames before authentication or asset access", async () => {
    let authenticationCalls = 0;
    const countingAuthenticator: RequestAuthenticator = async () => {
      authenticationCalls += 1;
      return IDENTITY;
    };
    const response = await createWorker(countingAuthenticator).fetch(
      new Request("https://alternate.example.org/auth/config"),
      fakeEnv(),
    );
    expect(response.status).toBe(421);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(authenticationCalls).toBe(0);
  });

  it("fails closed when the canonical application origin is invalid", async () => {
    const env = fakeEnv();
    env.APP_ORIGIN = "http://choir.example.org";
    const response = await createWorker(authenticated).fetch(
      new Request("https://choir.example.org/"),
      env,
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "configuration_unavailable" });
  });

  it("redirects anonymous HTML navigation to sign-in without an external return URL", async () => {
    const response = await createWorker(anonymous).fetch(
      new Request("https://choir.example.org/library?piece=x", {
        headers: { Accept: "text/html" },
      }),
      fakeEnv(),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/sign-in?return_url=%2Flibrary%3Fpiece%3Dx");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("does not redirect anonymous direct asset requests to an HTML page", async () => {
    const response = await createWorker(anonymous).fetch(
      new Request("https://choir.example.org/library-assets/song/bundle.json"),
      fakeEnv(),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "authentication_required" });
  });

  it("denies an authenticated member absent from the active allowlist", async () => {
    const response = await createWorker(authenticated).fetch(
      new Request("https://choir.example.org/library-assets/song/score.svg"),
      fakeEnv({ active: false }),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("renders a non-member page with status 403 for HTML navigation", async () => {
    const response = await createWorker(authenticated).fetch(
      new Request("https://choir.example.org/", { headers: { Accept: "text/html" } }),
      fakeEnv({ active: false }),
    );
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("asset:/not-authorized.html");
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("fails closed when authentication throws", async () => {
    const broken: RequestAuthenticator = async () => {
      throw new Error("identity provider unavailable");
    };
    const response = await createWorker(broken).fetch(
      new Request("https://choir.example.org/library.json"),
      fakeEnv(),
    );
    expect(response.status).toBe(401);
  });

  it("fails closed when authorization storage is unavailable", async () => {
    const response = await createWorker(authenticated).fetch(
      new Request("https://choir.example.org/library.json"),
      fakeEnv({ dbError: true }),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
  });

  it("serves authorized assets privately and preserves byte ranges", async () => {
    const response = await createWorker(authenticated).fetch(
      new Request("https://choir.example.org/library-assets/song/audio.mp3", {
        headers: { Range: "bytes=0-3" },
      }),
      fakeEnv(),
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 0-3/10");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toBe("Cookie, Authorization");
  });

  it("exposes only the publishable Clerk key in the public config", async () => {
    const response = await createWorker(anonymous).fetch(
      new Request("https://choir.example.org/auth/config"),
      fakeEnv(),
    );
    const body = JSON.stringify(await response.json());
    expect(response.status).toBe(200);
    expect(body).toContain("pk_test_not-a-secret");
    expect(body).not.toContain("test-public-jwt-verification-key");
    expect(body).not.toContain(SECRET);
  });

  it("serves sign-in with a constrained CSP", async () => {
    const response = await createWorker(anonymous).fetch(
      new Request("https://choir.example.org/sign-in"),
      fakeEnv(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "https://clerk.choir.example.org",
    );
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
