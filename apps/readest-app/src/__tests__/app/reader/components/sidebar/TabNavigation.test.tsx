import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TabNavigation from '@/app/reader/components/sidebar/TabNavigation';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: {} }) }));

afterEach(cleanup);

const Tabs = ({ dir = 'ltr' }: { dir?: 'ltr' | 'rtl' }) => {
  const [activeTab, setActiveTab] = useState('toc');
  return (
    <div dir={dir}>
      <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
};

describe('Reader sidebar tabs', () => {
  it('keeps one tab stop and activates tabs immediately with arrows, Home and End', () => {
    render(<Tabs />);
    const [contents, annotations, bookmarks] = screen.getAllByRole('tab');
    expect(contents?.tabIndex).toBe(0);
    expect(annotations?.tabIndex).toBe(-1);
    expect(bookmarks?.tabIndex).toBe(-1);

    contents?.focus();
    fireEvent.keyDown(contents!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(annotations);
    expect(annotations?.getAttribute('aria-selected')).toBe('true');
    expect(annotations?.tabIndex).toBe(0);
    expect(contents?.tabIndex).toBe(-1);

    fireEvent.keyDown(annotations!, { key: 'End' });
    expect(document.activeElement).toBe(bookmarks);
    fireEvent.keyDown(bookmarks!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(contents);
    fireEvent.keyDown(contents!, { key: 'End' });
    fireEvent.keyDown(bookmarks!, { key: 'Home' });
    expect(document.activeElement).toBe(contents);
  });

  it('follows the visual direction of RTL tabs', () => {
    render(<Tabs dir='rtl' />);
    const [contents, annotations] = screen.getAllByRole('tab');
    fireEvent.keyDown(contents!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(annotations);
    fireEvent.keyDown(annotations!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(contents);
  });
});
