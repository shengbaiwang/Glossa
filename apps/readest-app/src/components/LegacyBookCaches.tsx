import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { isTauriAppPlatform } from '@/services/environment';
import {
  inspectLegacyBrowserCaches,
  clearLegacyBrowserCaches,
  type LegacyBrowserCache,
} from '@/services/bookRemovalData';
import {
  inspectLegacyPDFCaches,
  clearLegacyPDFCaches,
  type LegacyPDFCache,
} from '@/services/pdfEnhancement';
import DeleteConfirmAlert from './DeleteConfirmAlert';
import ModalPortal from './ModalPortal';
import { NavigationRow } from './settings/primitives';
import { Database } from './GlossaIcons';
export default function LegacyBookCaches({ disabled = false }: { disabled?: boolean }) {
  const _ = useTranslation();
  const [review, setReview] = useState<{
    browser: LegacyBrowserCache[];
    pdf: LegacyPDFCache[];
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [done, setDone] = useState(false);
  const inspect = async () => {
    setBusy(true);
    setError('');
    setDone(false);
    try {
      const [browser, pdf] = await Promise.all([
        inspectLegacyBrowserCaches(),
        isTauriAppPlatform() ? inspectLegacyPDFCaches() : Promise.resolve([]),
      ]);
      setReview({ browser, pdf });
    } catch {
      setError('Could not read legacy shared data.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <NavigationRow
        title={_('Check legacy shared data')}
        icon={Database}
        disabled={busy || disabled}
        onClick={() => void inspect()}
      />
      {error && <p role='alert'>{_(error)}</p>}
      {done && <p role='status'>{_('Reviewed legacy shared data cleared.')}</p>}
      {review && !review.browser.length && !review.pdf.length && (
        <p role='status'>{_('No legacy shared data found.')}</p>
      )}
      {review && (review.browser.length > 0 || review.pdf.length > 0) && (
        <ModalPortal>
          <DeleteConfirmAlert
            title={_('Clear legacy shared data')}
            selectionLabel={_('Shared records: {{count}}', {
              count: review.browser.length + review.pdf.length,
            })}
            books={[
              {
                hash: 'legacy-generated',
                title: _('Shared generated cache rows: {{count}}', {
                  count: review.browser.length,
                }),
              },
              {
                hash: 'legacy-pdf',
                title: _('Shared PDF sidecar folders: {{count}}', { count: review.pdf.length }),
              },
            ]}
            message={_(
              'These older shared records cannot be assigned to one book. Cleanup affects all books using them and includes old PDF text recognition and saved outlines, including personal outlines. It cannot be undone. Original files, current book-owned data, notes, conversations and mind maps are kept.',
            )}
            scope={_('This device only.')}
            confirmLabel={_('Clear reviewed data')}
            destructive
            onCancel={() => setReview(null)}
            onConfirm={async () => {
              setBusy(true);
              setError('');
              try {
                await clearLegacyBrowserCaches(review.browser);
                if (review.pdf.length) await clearLegacyPDFCaches(review.pdf);
                setReview(null);
                setDone(true);
              } catch {
                setError('Shared data changed or cleanup failed. Check it again before retrying.');
                setReview(null);
              } finally {
                setBusy(false);
              }
            }}
          />
        </ModalPortal>
      )}
    </div>
  );
}
