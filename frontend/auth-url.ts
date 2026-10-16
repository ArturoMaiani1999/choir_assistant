export function safeReturnPath(candidate: string | null, origin: string): string {
  const value = candidate ?? "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  const parsed = new URL(value, origin);
  if (parsed.origin !== origin || parsed.pathname.startsWith("/auth/")) return "/";
  if (["/sign-in", "/sign-in.html", "/sign-up", "/sign-up.html"].includes(parsed.pathname)) {
    return "/";
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
