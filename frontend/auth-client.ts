import { Clerk } from "@clerk/clerk-js";
import { itIT } from "@clerk/localizations";
import { ClerkUI } from "@clerk/ui/entry";
import { safeReturnPath } from "./auth-url";

interface PublicConfig {
  publishableKey: string;
}

async function main(): Promise<void> {
  const status = document.querySelector<HTMLElement>("#auth-status");
  const mount = document.querySelector<HTMLDivElement>("#clerk-sign-in");
  const actions = document.querySelector<HTMLElement>("#signed-in-actions");
  if (!status || !mount || !actions) throw new Error("Authentication UI is incomplete");

  const response = await fetch("/auth/config", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Unable to load authentication configuration");
  const config = (await response.json()) as PublicConfig;
  const clerk = new Clerk(config.publishableKey);
  await clerk.load({
    localization: itIT,
    ui: { ClerkUI },
  });
  const returnPath = safeReturnPath(
    new URLSearchParams(location.search).get("return_url"),
    location.origin,
  );

  if (clerk.user) {
    const denied = document.body.dataset.authReason === "not-authorized"
      || new URLSearchParams(location.search).get("reason") === "not-authorized";
    status.textContent = denied
      ? "Questo indirizzo non è presente nella lista dei coristi autorizzati."
      : "Accesso eseguito. Verifico l’autorizzazione all’apertura dell’app.";
    actions.hidden = false;
    if (!denied) {
      const continueLink = document.createElement("a");
      continueLink.className = "continue";
      continueLink.href = returnPath;
      continueLink.textContent = "Continua";
      actions.appendChild(continueLink);
      actions.appendChild(document.createTextNode(" "));
    }
    const logout = document.createElement("button");
    logout.type = "button";
    logout.textContent = "Esci";
    logout.addEventListener("click", async () => {
      await clerk.signOut({ redirectUrl: "/sign-in" });
    });
    actions.appendChild(logout);
    return;
  }

  status.textContent = "";
  if (document.body.dataset.authMode === "sign-up") {
    clerk.mountSignUp(mount, {
      fallbackRedirectUrl: returnPath,
      forceRedirectUrl: returnPath,
      routing: "hash",
      signInUrl: `/sign-in?return_url=${encodeURIComponent(returnPath)}`,
    });
    return;
  }
  clerk.mountSignIn(mount, {
    fallbackRedirectUrl: returnPath,
    forceRedirectUrl: returnPath,
    routing: "hash",
    signUpUrl: `/sign-up?return_url=${encodeURIComponent(returnPath)}`,
  });
}

main().catch((error: unknown) => {
  const status = document.querySelector<HTMLElement>("#auth-status");
  if (status) {
    status.className = "error";
    status.textContent = "Accesso temporaneamente non disponibile. Riprova più tardi.";
  }
  console.error(error instanceof Error ? error.message : "Authentication initialization failed");
});
