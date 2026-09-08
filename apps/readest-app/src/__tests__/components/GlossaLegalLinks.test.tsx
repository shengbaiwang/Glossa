import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: () => 24 }));
vi.mock('@/components/Link', () => ({
  default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}));

import LegalLinks from '@/components/LegalLinks';
import SupportLinks from '@/components/SupportLinks';

afterEach(cleanup);

describe('Glossa legal and support destinations', () => {
  it('identifies the actual cloud provider whose terms apply', () => {
    render(<LegalLinks />);

    expect(
      screen.getByRole('link', { name: 'Readest Cloud Terms of Service' }).getAttribute('href'),
    ).toBe('https://readest.com/terms-of-service');
    expect(
      screen.getByRole('link', { name: 'Readest Cloud Privacy Policy' }).getAttribute('href'),
    ).toBe('https://readest.com/privacy-policy');
  });

  it('directs Glossa support to its own issue tracker', () => {
    render(<SupportLinks />);

    expect(screen.getByText('Glossa support')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'GitHub' }).getAttribute('href')).toBe(
      'https://github.com/shengbaiwang/Glossa/issues',
    );
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });
});
