import React, { useId } from 'react';
import clsx from 'clsx';
import { Info, Lock, LockOpen, CircleAlert } from '@/components/GlossaIcons';
import { useTranslation } from '@/hooks/useTranslation';

interface SourceIndicatorProps {
  source?: string;
}

const SourceIndicator: React.FC<SourceIndicatorProps> = ({ source }) => {
  if (!source) return null;
  const [sourceName, confidence] = source.split('-');
  return (
    <div className='glossa-metadata-source glossa-supporting-text'>
      <Info className='h-3 w-3' />
      <span className='capitalize'>
        {sourceName} ({confidence}%)
      </span>
    </div>
  );
};

interface FormFieldProps {
  type?: 'input' | 'textarea';
  field: string;
  label: string;
  isNumber?: boolean;
  required?: boolean;
  disabled?: boolean;
  lockable?: boolean;
  fieldSources: Record<string, string>;
  lockedFields: Record<string, boolean>;
  fieldErrors: Record<string, string>;
  onToggleFieldLock: (field: string) => void;
  value: string;
  onFieldChange: (field: string, value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
}

const FormField: React.FC<FormFieldProps> = ({
  type = 'input',
  field,
  label,
  fieldSources,
  lockedFields,
  fieldErrors,
  isNumber = false,
  required = false,
  lockable = true,
  disabled = false,
  onToggleFieldLock,
  value,
  onFieldChange,
  placeholder,
  rows,
  className,
}) => {
  const _ = useTranslation();
  const id = useId();
  const errorId = `${id}-error`;
  const isLocked = !!lockedFields[field];
  const error = fieldErrors[field];
  const lockAction = isLocked ? _('Unlock field') : _('Lock field');
  const inputProps = {
    id,
    name: field,
    value,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onFieldChange(field, event.target.value),
    placeholder: isLocked ? '' : placeholder,
    disabled: disabled || isLocked,
    'aria-required': required || undefined,
    'aria-invalid': !!error,
    'aria-describedby': error ? errorId : undefined,
    className: clsx(
      'glossa-field glossa-metadata-input eink-bordered',
      lockable && 'has-lock',
      className,
    ),
  };

  return (
    <div className='glossa-metadata-field' data-locked={isLocked}>
      <label htmlFor={id}>
        {label}
        {required && (
          <span aria-hidden='true' className='glossa-metadata-required'>
            {' '}
            *
          </span>
        )}
      </label>
      <div className='glossa-metadata-control'>
        {type === 'input' ? (
          <input
            {...inputProps}
            type={isNumber ? 'number' : 'text'}
            min={isNumber ? 1 : undefined}
          />
        ) : (
          <textarea {...inputProps} rows={rows || 4} />
        )}
        {lockable && (
          <button
            type='button'
            onClick={() => onToggleFieldLock(field)}
            disabled={disabled}
            className='glossa-icon-button glossa-metadata-lock'
            aria-label={`${lockAction}: ${label}`}
            aria-pressed={isLocked}
            title={lockAction}
          >
            {isLocked ? <Lock className='h-4 w-4' /> : <LockOpen className='h-4 w-4' />}
          </button>
        )}
      </div>
      {error ? (
        <div id={errorId} className='glossa-metadata-error' role='alert'>
          <CircleAlert className='h-3 w-3 shrink-0' />
          <span>{error}</span>
        </div>
      ) : (
        <SourceIndicator source={fieldSources[field]} />
      )}
    </div>
  );
};

export { FormField, SourceIndicator };
