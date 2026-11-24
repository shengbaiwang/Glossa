import { useSyncExternalStore } from 'react';
import type { Book } from '@/types/book';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { syncOrigin } from '@/glossa/sync/config';
import {
  policyChanged,
  releasePeriods,
  releaseDays,
  setReleaseDays,
  isPinned,
  setPinned,
} from '@/glossa/sync/releasePolicy';
import { eventDispatcher } from '@/utils/event';

function subscribe(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener(policyChanged, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(policyChanged, callback);
  };
}

export function CloudDownloadPolicy({ pointer }: { pointer?: NonNullable<Book['glossaCloud']> }) {
  const _ = useTranslation();
  const subject = useLibraryStore((s) => s.cloudSubject);
  const origin = syncOrigin();
  const owner = origin && subject ? { origin, subject } : null;
  const allowed = owner && (!pointer || (pointer.subject === subject && pointer.origin === origin));
  const value = useSyncExternalStore(
    subscribe,
    () => {
      if (!allowed) return null;
      try {
        return pointer ? Number(isPinned(pointer)) : releaseDays(owner);
      } catch {
        return null;
      }
    },
    () => null,
  );
  if (value === null || !owner) return null;
  const change = (next: number) => {
    try {
      if (pointer) setPinned(pointer, Boolean(next));
      else setReleaseDays(owner, next);
    } catch {
      eventDispatcher.dispatch('toast', { type: 'error', message: _('Could not save settings') });
    }
  };
  return (
    <label className='flex items-center justify-between gap-4 px-4 py-3'>
      {pointer ? _('Keep download on this device') : _('Clear downloads after finishing')}
      {pointer ? (
        <input
          type='checkbox'
          className='toggle toggle-sm'
          checked={Boolean(value)}
          onChange={(e) => change(Number(e.target.checked))}
        />
      ) : (
        <select
          className='select select-sm'
          value={value}
          onChange={(e) => change(Number(e.target.value))}
        >
          {releasePeriods.map((days) => (
            <option key={days} value={days}>
              {days ? _('{{count}} days', { count: days }) : _('Never')}
            </option>
          ))}
        </select>
      )}
    </label>
  );
}
