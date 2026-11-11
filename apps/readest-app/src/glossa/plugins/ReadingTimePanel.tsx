import { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import { getReadingSession } from './readingActivity';
import { getReadingTimeClient } from './readingTime';

function ReadingDuration({ durationMs }: { durationMs: number }) {
  const _ = useTranslation();
  const minutes = Math.floor(durationMs / 60_000);
  if (minutes === 0 && durationMs > 0) return <>{_('Less than 1 min')}</>;
  if (minutes < 60) return <>{_('{{minutes}} min', { minutes })}</>;
  return (
    <>
      {_('{{hours}} h {{minutes}} min', { hours: Math.floor(minutes / 60), minutes: minutes % 60 })}
    </>
  );
}

export default function ReadingTimePanel({ bookKey }: { bookKey?: string }) {
  const _ = useTranslation();
  const { appService } = useEnv();
  const library = useLibraryStore((s) => s.library);
  const book = bookKey ? useBookDataStore.getState().getBookData(bookKey)?.book : undefined;
  const bookHash = book?.hash;
  const [summary, setSummary] =
    useState<Awaited<ReturnType<StatisticsDb['getReadingTimeSummary']>>>();
  const [detail, setDetail] = useState({ bookMs: 0, sessionMs: 0, active: false });
  const [extraTitles, setExtraTitles] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!appService?.isMacOSApp) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const client = getReadingTimeClient(appService);
    const read = async () => {
      try {
        // Flush completed slices before reading the durable totals.
        await client.refresh();
        const status = client.getSnapshot();
        const db = await StatisticsDb.open(appService);
        if (bookKey && bookHash) {
          const sessionId = getReadingSession(bookKey)?.sessionId ?? '';
          const totals = await db.getBookReadingTime(bookHash, sessionId);
          const active = !!sessionId && status.activeSessionId === sessionId;
          if (alive) setDetail({ ...totals, active });
        } else {
          const next = await db.getReadingTimeSummary();
          if (alive) setSummary(next);
        }
        if (alive) {
          setLoaded(true);
          setError(status.error);
        }
      } catch {
        if (alive) setError(true);
      } finally {
        if (alive) timer = setTimeout(() => void read(), bookKey ? 1500 : 5000);
      }
    };
    void read();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [appService, bookKey, bookHash, retry]);

  useEffect(() => {
    if (!appService || !summary?.books.length) return;
    let alive = true;
    const missing = summary.books
      .filter(
        ({ bookHash }) => !extraTitles[bookHash] && !library.some(({ hash }) => hash === bookHash),
      )
      .map(({ bookHash }) => bookHash);
    if (missing.length)
      void appService
        .loadLibraryBooks(missing)
        .then((books) => {
          if (!alive) return;
          const titles = Object.fromEntries(
            missing.map((hash) => [
              hash,
              books.find((book) => book.hash === hash)?.title ?? _('Unavailable book'),
            ]),
          );
          setExtraTitles((previous) => ({ ...previous, ...titles }));
        })
        .catch(() => {});
    return () => {
      alive = false;
    };
  }, [appService, summary, extraTitles, library, _]);

  if (!appService?.isMacOSApp) return null;
  const row = (label: string, durationMs: number) => (
    <div className='flex items-baseline justify-between gap-5 py-1'>
      <dt className='min-w-0 break-words'>{label}</dt>
      <dd className='shrink-0 tabular-nums'>
        <ReadingDuration durationMs={durationMs} />
      </dd>
    </div>
  );
  return (
    <div className={bookKey ? 'min-w-44 px-3 py-2 text-sm' : 'space-y-4 text-sm'}>
      {loaded &&
        (bookKey ? (
          <>
            <p className='glossa-supporting-text pb-2'>
              {_(detail.active ? 'Timing' : 'Timing paused')}
            </p>
            <dl>
              {row(_('This session'), detail.sessionMs)}
              {row(_('This book'), detail.bookMs)}
            </dl>
          </>
        ) : (
          summary && (
            <>
              <p className='glossa-supporting-text'>
                {_('Estimated from reading activity on this Mac.')}
              </p>
              <dl className='glossa-group-card eink-bordered p-4'>
                {row(_('Today'), summary.todayMs)}
                {row(_('All time'), summary.totalMs)}
              </dl>
              {summary.books.length ? (
                <dl className='glossa-group-card eink-bordered p-4'>
                  {summary.books.map(({ bookHash, durationMs }) => (
                    <div key={bookHash}>
                      {row(
                        library.find((book) => book.hash === bookHash)?.title ??
                          extraTitles[bookHash] ??
                          _('Unavailable book'),
                        durationMs,
                      )}
                    </div>
                  ))}
                </dl>
              ) : (
                <p className='glossa-supporting-text'>{_('No reading time recorded yet.')}</p>
              )}
            </>
          )
        ))}
      {!loaded && !error && <p role='status'>{_('Loading...')}</p>}
      {error && (
        <div className='mt-2 space-y-2'>
          <p role='alert' className='glossa-supporting-text'>
            {_('Could not save or load reading time.')}
          </p>
          <button
            type='button'
            className='glossa-button'
            onClick={() => setRetry((value) => value + 1)}
          >
            {_('Retry')}
          </button>
        </div>
      )}
    </div>
  );
}
