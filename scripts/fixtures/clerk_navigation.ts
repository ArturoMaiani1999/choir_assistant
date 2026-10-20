// Local browser-test adapter. Never included in the production build.
export const itIT = {};
export const ClerkUI = {};
export class Clerk {
  user = localStorage.getItem('audit-signed-out') === '1' ? null : { id: 'audit-user' };
  async load() {}
  async signOut(options: { redirectUrl: string }) {
    localStorage.setItem('audit-signed-out', '1');
    (window as any).__authRedirect = options.redirectUrl;
  }
  mountSignIn(element: HTMLElement) { element.textContent = 'Accesso email'; element.dataset.ready = 'true'; }
  mountSignUp(element: HTMLElement) { element.textContent = 'Registrazione email'; element.dataset.ready = 'true'; }
}
