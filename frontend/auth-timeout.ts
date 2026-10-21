// Bound network-dependent promises without retrying requests or mutations.
declare global {
  interface Window {
    ChoirStartup?: { ready(): void; fail(): void };
  }
}

export async function withTimeout<T>(promise: Promise<T>, milliseconds = 15_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Il caricamento richiede troppo tempo. Riprova.')), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
