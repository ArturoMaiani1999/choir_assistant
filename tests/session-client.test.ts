import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { load, getToken } = vi.hoisted(() => ({ load: vi.fn(), getToken: vi.fn() }));
vi.mock('@clerk/clerk-js', () => ({
  Clerk: class {
    load = load;
    session = { getToken };
  },
}));

describe('bounded session initialization', () => {
  beforeEach(() => {
    vi.resetModules(); vi.useFakeTimers();
    load.mockReset().mockResolvedValue(undefined);
    getToken.mockReset().mockResolvedValue('renewed-token');
    vi.stubGlobal('window', {});
    vi.stubGlobal('location', { href: 'https://choir.example.org/', origin: 'https://choir.example.org' });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input) => input === '/auth/config'
      ? Response.json({ publishableKey: 'pk_test_fixture' }) : Response.json({ ok: true })));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('rejects a stalled SDK load instead of leaving API reads pending', async () => {
    load.mockImplementation(() => new Promise(() => {}));
    await import('../frontend/session-client');
    const result = expect(window.ChoirAuthReady).rejects.toThrow('Riprova');
    await vi.advanceTimersByTimeAsync(15_000);
    await result;
    await expect(window.ChoirAuthFetch('/api/me')).rejects.toThrow('Riprova');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('bounds a stalled token renewal without sending an unauthenticated fallback', async () => {
    getToken.mockImplementation(() => new Promise(() => {}));
    await import('../frontend/session-client');
    await window.ChoirAuthReady;
    const result = expect(window.ChoirAuthFetch('/api/me')).rejects.toThrow('Riprova');
    await vi.advanceTimersByTimeAsync(15_000);
    await result;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves renewed bearer tokens, cookies and caller cancellation on API reads', async () => {
    await import('../frontend/session-client');
    const abort = new AbortController();
    await window.ChoirAuthFetch('/api/me', { signal: abort.signal });
    const options = vi.mocked(fetch).mock.calls[1][1]!;
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer renewed-token');
    expect(options.credentials).toBe('same-origin');
    abort.abort();
    expect(options.signal?.aborted).toBe(true);
  });

  it('does not impose the small API read deadline on recording uploads', async () => {
    await import('../frontend/session-client');
    const abort = new AbortController();
    await window.ChoirAuthFetch('/api/recordings', { method: 'POST', signal: abort.signal, body: 'recording' });
    expect(vi.mocked(fetch).mock.calls[1][1]?.signal).toBe(abort.signal);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
