import { BookOpen, Folder, LibraryBig, Tags, Users, Layers } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { LibraryGroupByType } from '@/types/settings';
import { navigateToLibrary } from '@/utils/nav';
import { ensureLibraryGroupByType } from '../utils/libraryUtils';

export default function LibraryNavigation({ onNavigate }: { onNavigate: () => void }) {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { settings } = useSettingsStore();
  const groupBy = ensureLibraryGroupByType(searchParams?.get('groupBy'), settings.libraryGroupBy);
  const categories = [
    { value: LibraryGroupByType.None, label: _('Books'), Icon: BookOpen },
    { value: LibraryGroupByType.Group, label: _('Groups'), Icon: Folder },
    { value: LibraryGroupByType.Author, label: _('Authors'), Icon: Users },
    { value: LibraryGroupByType.Series, label: _('Series'), Icon: LibraryBig },
    { value: LibraryGroupByType.Tag, label: _('Tags'), Icon: Tags },
    { value: LibraryGroupByType.Subject, label: _('Subjects'), Icon: Layers },
  ];

  return (
    <nav
      id='library-navigation'
      className='glossa-library-navigation'
      aria-label={_('Library')}
      onKeyDown={(event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (current < 0) return;
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : Math.max(
                  0,
                  Math.min(buttons.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)),
                );
        buttons[next]?.focus();
        event.preventDefault();
      }}
    >
      <h2>{_('Library')}</h2>
      {categories.map(({ value, label, Icon }) => (
        <button
          key={value}
          type='button'
          aria-current={groupBy === value ? 'page' : undefined}
          onClick={() => {
            const params = new URLSearchParams(searchParams?.toString());
            params.set('groupBy', value);
            // Keep a nonempty query even at the root (Next static-export navigation).
            params.set('group', '');
            onNavigate();
            navigateToLibrary(router, params.toString());
          }}
        >
          <Icon size={17} strokeWidth={1.75} aria-hidden='true' />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
