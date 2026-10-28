import { useTranslation } from '@/hooks/useTranslation';
import ImportDialog from './ImportDialog';
import ImportProgress from './ImportProgress';

export interface FileImportState {
  completed: number;
  total: number;
  stopping?: boolean;
  saving?: boolean;
  error?: boolean;
  activity?: string;
}
export default function FileImportDialog({
  state,
  onCancel,
  onRetry,
}: {
  state: FileImportState;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const _ = useTranslation();
  return (
    <ImportDialog title={_('Import files')} onClose={onCancel}>
      <div className='flex flex-col gap-4 py-2'>
        <ImportProgress
          paused={state.error}
          label={_(
            state.error
              ? 'Import failed'
              : state.stopping
                ? 'Stopping…'
                : state.saving
                  ? 'Saving to library…'
                  : 'Importing…',
          )}
          detail={_('Importing {{completed}} of {{total}} books…', {
            completed: state.completed,
            total: state.total,
          })}
          completed={state.saving || state.error ? undefined : state.completed}
          total={state.total}
          activity={state.activity}
        />
        {state.error && (
          <p role='alert' className='text-error text-sm'>
            {_('Couldn’t finish importing. Please try again.')}
          </p>
        )}
        <div className='glossa-import-actions'>
          <button
            type='button'
            className='btn btn-ghost btn-sm eink-bordered'
            disabled={state.stopping}
            onClick={onCancel}
          >
            {_('Cancel')}
          </button>
          {state.error && (
            <button type='button' className='btn btn-contrast btn-sm' onClick={onRetry}>
              {_('Try again')}
            </button>
          )}
        </div>
      </div>
    </ImportDialog>
  );
}
