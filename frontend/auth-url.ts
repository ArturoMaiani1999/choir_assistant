export function safeReturnPath(candidate: string | null, origin: string): string {
  const value = candidate ?? "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  const parsed = new URL(value, origin);
  if (parsed.origin !== origin || parsed.pathname.startsWith("/auth/")) return "/";
  if (parsed.pathname === "/sign-in" || parsed.pathname === "/sign-in.html") return "/";
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
