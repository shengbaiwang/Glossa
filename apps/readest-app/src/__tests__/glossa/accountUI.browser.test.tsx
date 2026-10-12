import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { SupabaseClient } from '@supabase/supabase-js';
import AuthPanel from '@/app/auth/components/AuthPanel';
import '@/styles/globals.css';
import '@/styles/glossa.css';
import '@/styles/glossa-library.css';

const state = vi.hoisted(() => ({
  configured: false,
  signIn: vi.fn(),
  signUp: vi.fn(),
  translations: {} as Record<string, string>,
}));
vi.mock('@/glossa/account/config', () => ({
  isGlossaAuthConfigured: () => state.configured,
  getGlossaIdentityProviders: () => ['apple', 'google', 'azure'],
}));
vi.mock('next/image', () => ({
  __esModule: true,
  default: ({ src, alt, width, height, className }: React.ImgHTMLAttributes<HTMLImageElement>) => (
    <img src={src} alt={alt} width={width} height={height} className={className} />
  ),
}));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, params?: Record<string, string>) => {
    const values = state.translations;
    return Object.entries(params ?? {}).reduce(
      (text, [key, value]) => text.replace(`{{${key}}}`, value),
      values[key] ?? key,
    );
  },
}));

const client = {
  auth: { signInWithPassword: state.signIn, signUp: state.signUp },
} as unknown as SupabaseClient;
beforeAll(async () => {
  state.translations = await (await fetch('/locales/zh-CN/translation.json')).json();
});
function Fixture() {
  return (
    <main className='bg-base-100 text-base-content flex min-h-screen justify-center px-6 py-16'>
      <AuthPanel
        supabaseClient={client}
        redirectTo='glossa://auth-callback'
        onProviderSignIn={vi.fn()}
      />
    </main>
  );
}
beforeEach(() => {
  state.configured = false;
  state.signIn.mockReset().mockResolvedValue({ error: null });
  state.signUp
    .mockReset()
    .mockResolvedValue({ data: { user: { id: 'original-fixture' }, session: null }, error: null });
});
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
});
it('shows the real unconfigured state, allows reading, and has no fake sign-in controls', async () => {
  await page.viewport(1100, 850);
  document.documentElement.setAttribute('data-theme', 'default-light');
  render(<Fixture />);
  expect(screen.getByRole('status').textContent).toContain('尚未配置');
  expect(screen.getByRole('link', { name: '继续阅读' }).getAttribute('href')).toBe('/library');
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByText('Readest')).toBeNull();
  await page.screenshot({ path: '../../../../../.glossa-dev/qa/account-unconfigured.png' });
});
it('keeps the login form within narrow light and dark viewports and recovers from network failure', async () => {
  state.configured = true;
  await page.viewport(390, 900);
  render(<Fixture />);
  const email = screen.getByRole('textbox', { name: '电子邮件地址' });
  const password = screen.getByLabelText('您的密码');
  for (const theme of ['default-light', 'default-dark']) {
    document.documentElement.setAttribute('data-theme', theme);
    email.focus();
    expect(getComputedStyle(email).outlineStyle).toBe('solid');
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
    expect(email.getBoundingClientRect().width).toBeGreaterThan(260);
    expect(
      screen.getAllByRole('button').every((button) => button.getBoundingClientRect().right <= 390),
    ).toBe(true);
    await page.screenshot({ path: `../../../../../.glossa-dev/qa/account-${theme}.png` });
  }
  fireEvent.change(email, { target: { value: 'reader@example.test' } });
  fireEvent.change(password, { target: { value: 'original-password' } });
  state.signIn.mockRejectedValueOnce(new Error('network failure'));
  fireEvent.submit(email.closest('form')!);
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('无法连接'));
  expect((email as HTMLInputElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '没有账号？注册' }));
  expect((screen.getByLabelText('创建密码') as HTMLInputElement).minLength).toBe(8);
  expect((screen.getByRole('textbox', { name: '电子邮件地址' }) as HTMLInputElement).value).toBe(
    'reader@example.test',
  );
  fireEvent.change(screen.getByLabelText('创建密码'), { target: { value: 'original-password' } });
  fireEvent.submit(screen.getByRole('textbox').closest('form')!);
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('确认链接'));
  expect(state.signUp).toHaveBeenCalledWith({
    email: 'reader@example.test',
    password: 'original-password',
    options: { emailRedirectTo: 'glossa://auth-callback' },
  });
});
