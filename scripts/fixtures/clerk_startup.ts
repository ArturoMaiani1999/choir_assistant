// Browser-test adapter only; never included in the production build.
export const itIT = {};
export const ClerkUI = {};
export class Clerk {
  user = null;
  session = { getToken: async () => 'startup-fixture-token' };
  async load() { await fetch('/fixture/sdk-ready'); }
  mountSignIn(element: HTMLElement) {
    const input = document.createElement('input');
    input.setAttribute('aria-label', 'Indirizzo email');
    element.append(input);
  }
  mountSignUp(element: HTMLElement) { this.mountSignIn(element); }
}
