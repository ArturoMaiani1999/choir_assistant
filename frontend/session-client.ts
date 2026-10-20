import { Clerk } from "@clerk/clerk-js";

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
  });
  if (!response.ok) throw new Error("Unable to load authentication configuration");
  const config = (await response.json()) as PublicConfig;
  clerk = new Clerk(config.publishableKey);
  await clerk.load();
}

window.ChoirAuthReady = initialize();
window.ChoirAuthFetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
  await window.ChoirAuthReady;
  const headers = new Headers(init.headers);
  const token = await clerk?.session?.getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { credentials: "same-origin", ...init, headers });
};

