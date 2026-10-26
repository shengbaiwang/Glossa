import { LoaderCircle } from '@/components/GlossaIcons';

export default function ImportProgress({
  label,
  detail,
  completed,
  total,
  paused = false,
}: {
  paused?: boolean;
  label: string;
  detail?: string;
  completed?: number;
  total?: number;
}) {
  const value =
    total && completed !== undefined
      ? Math.min(100, Math.max(0, (completed / total) * 100))
      : undefined;
  return (
    <div
      className={`glossa-import-progress${paused ? ' glossa-import-paused' : ''}`}
      role='status'
      aria-live='polite'
      aria-atomic='true'
    >
      <LoaderCircle className='glossa-import-spinner' size={28} aria-hidden='true' />
      <p className='text-sm font-medium'>{label}</p>
      {detail && (
        <p className='text-base-content/60 max-w-full truncate text-xs' dir='auto' title={detail}>
          {detail}
        </p>
      )}
      <div
        className='glossa-import-track'
        role='progressbar'
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={label}
      >
        <span
          className={value === undefined ? 'glossa-import-indeterminate' : ''}
          style={value === undefined ? undefined : { width: `${value}%` }}
        />
      </div>
    </div>
  );
}
