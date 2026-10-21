import { Clerk } from "@clerk/clerk-js";
import { withTimeout } from './auth-timeout';

interface PublicConfig {
  publishableKey: string;
}

declare global {
  interface Window {
    ChoirAuthFetch: typeof fetch;
    ChoirAuthReady: Promise<void>;
  }
}

let clerk: Clerk | null = null;

async function initialize(): Promise<void> {
  const response = await fetch("/auth/config", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Unable to load authentication configuration");
  const config = (await withTimeout(response.json())) as PublicConfig;
  clerk = new Clerk(config.publishableKey);
  await withTimeout(clerk.load());
}

window.ChoirAuthReady = initialize();
// Initialization can reject before the first API consumer attaches its handler.
void window.ChoirAuthReady.catch(() => {});
window.ChoirAuthFetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
  await window.ChoirAuthReady;
  const headers = new Headers(init.headers);
  const token = await withTimeout(Promise.resolve(clerk?.session?.getToken()));
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  // Bound small API reads. Audio transfers and uploads keep their caller's policy.
  if (url.origin === location.origin && url.pathname.startsWith('/api/') && method === 'GET') {
    const signal = init.signal ?? (input instanceof Request ? input.signal : undefined);
    const deadline = AbortSignal.timeout(20_000);
    return fetch(input, { credentials: 'same-origin', ...init, headers,
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
  }
  return fetch(input, { credentials: "same-origin", ...init, headers });
};

