import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  signOut: vi.fn(),
  refreshSession: vi.fn(),
  receive: null as null | ((event: string, session: Session | null) => void),
  unsubscribe: vi.fn(),
}));
vi.mock('@/utils/supabase', () => ({
  supabase: {
    auth: {
      ...auth,
      onAuthStateChange: (receive: typeof auth.receive) => {
        auth.receive = receive;
        return { data: { subscription: { unsubscribe: auth.unsubscribe } } };
      },
    },
  },
}));
import { AuthProvider, useAuth } from '@/context/AuthContext';
let value: ReturnType<typeof useAuth>;
function Probe() {
  value = useAuth();
  return null;
}
const mount = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
const session = { access_token: 'own-token', user: { id: 'own-user' } } as Session;
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  auth.receive = null;
  vi.stubEnv('NEXT_PUBLIC_GLOSSA_AUTH_URL', 'https://auth.glossa.test');
  vi.stubEnv('NEXT_PUBLIC_GLOSSA_AUTH_KEY', 'public-key');
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  auth.signOut.mockResolvedValue({ error: null });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});
describe('Glossa session isolation', () => {
  it('keeps legacy credentials without treating them as Glossa login', async () => {
    localStorage.setItem('token', 'legacy-token');
    localStorage.setItem('user', JSON.stringify({ id: 'legacy-user' }));
    mount();
    await waitFor(() => expect(auth.getSession).toHaveBeenCalled());
    expect(value.token).toBeNull();
    expect(value.user).toBeNull();
    expect(localStorage.getItem('token')).toBe('legacy-token');
  });
  it('does not restore a stale startup session over a subsequent sign-out', async () => {
    let resolve!: (v: { data: { session: Session }; error: null }) => void;
    auth.getSession.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    mount();
    act(() => auth.receive?.('SIGNED_OUT', null));
    await act(async () => resolve({ data: { session }, error: null }));
    expect(value.user).toBeNull();
  });
  it('signs out only the Glossa session and leaves personal cloud settings intact', async () => {
    localStorage.setItem('token', 'legacy-token');
    localStorage.setItem('personal-cloud', 'connected');
    mount();
    act(() => auth.receive?.('SIGNED_IN', session));
    expect(value.token).toBe('own-token');
    await act(async () => value.logout());
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(value.user).toBeNull();
    expect(localStorage.getItem('token')).toBe('legacy-token');
    expect(localStorage.getItem('personal-cloud')).toBe('connected');
  });
  it('makes no auth calls without an independent project', async () => {
    vi.stubEnv('NEXT_PUBLIC_GLOSSA_AUTH_KEY', '');
    mount();
    await act(async () => value.logout());
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});
