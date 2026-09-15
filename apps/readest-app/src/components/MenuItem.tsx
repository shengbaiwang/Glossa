import clsx from 'clsx';
import React from 'react';
import { IconType } from 'react-icons';
import { Check } from '@/components/GlossaIcons';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';

interface MenuItemProps {
  label: string;
  toggled?: boolean;
  description?: string;
  tooltip?: string;
  buttonClass?: string;
  labelClass?: string;
  shortcut?: string;
  disabled?: boolean;
  noIcon?: boolean;
  transient?: boolean;
  Icon?: React.ReactNode | IconType;
  iconClassName?: string;
  children?: React.ReactNode;
  siblings?: React.ReactNode;
  detailsOpen?: boolean;
  onClick?: () => void;
  setIsDropdownOpen?: (isOpen: boolean) => void;
}

const MenuItem: React.FC<MenuItemProps> = ({
  label,
  toggled,
  description,
  tooltip,
  buttonClass,
  labelClass,
  shortcut,
  disabled,
  noIcon = false,
  transient = false,
  Icon,
  iconClassName,
  children,
  siblings,
  detailsOpen = false,
  onClick,
  setIsDropdownOpen,
}) => {
  const _ = useTranslation();
  const iconSize = useResponsiveSize(16);
  const [isDetailsOpen, setIsDetailsOpen] = React.useState(detailsOpen);
  const IconType =
    Icon ||
    (toggled !== undefined ? (
      toggled ? (
        <Check size={iconSize} aria-hidden='true' />
      ) : undefined
    ) : undefined);

  const handleClick = () => {
    onClick?.();
    if (transient) {
      setIsDropdownOpen?.(false);
    }
  };

  const buttonContent = (
    <>
      <div className='flex w-full items-center justify-between gap-2'>
        <div className='flex min-w-0 items-center'>
          {!noIcon && (
            <span
              className='glossa-menu-icon inline-flex shrink-0 items-center justify-center'
              style={{ width: `${iconSize}px` }}
            >
              {typeof IconType === 'function' ? (
                <IconType
                  className={clsx(
                    disabled ? 'text-neutral-content' : 'text-base-content',
                    iconClassName,
                  )}
                  size={iconSize}
                />
              ) : (
                IconType
              )}
            </span>
          )}
          <span
            className={clsx(
              'glossa-menu-label mx-2 flex-1 break-words text-pretty text-start',
              labelClass,
            )}
            style={{ minWidth: 0 }}
          >
            {label}
          </span>
        </div>
        <div className='flex shrink-0 items-center gap-2'>
          {shortcut && (
            <kbd
              className={clsx(
                'border-base-300/40 bg-base-300/75 hidden rounded-md border shadow-sm sm:flex',
                'shrink-0 px-1.5 py-0.5 text-xs font-medium',
                disabled ? 'text-neutral-content' : 'text-neutral-content',
              )}
            >
              {shortcut}
            </kbd>
          )}
          {Icon && toggled !== undefined && (
            <span
              className='glossa-menu-check inline-flex shrink-0 items-center justify-center'
              style={{ width: `${iconSize}px` }}
              aria-hidden='true'
            >
              {toggled && <Check size={iconSize} />}
            </span>
          )}
        </div>
      </div>
      <div className='flex w-full'>
        {description && (
          <span
            className='mt-1 truncate text-start text-xs text-neutral-content'
            style={{ minWidth: 0, paddingInlineStart: noIcon ? '0' : `${iconSize + 8}px` }}
          >
            {description}
          </span>
        )}
      </div>
    </>
  );

  if (children) {
    return (
      <ul className='menu rounded-box m-0 p-0'>
        <li aria-label={label}>
          <details open={detailsOpen} onToggle={(e) => setIsDetailsOpen(e.currentTarget.open)}>
            <summary
              role='button'
              tabIndex={disabled ? -1 : 0}
              aria-disabled={disabled || undefined}
              onClick={(event) => {
                if (disabled) event.preventDefault();
              }}
              aria-expanded={isDetailsOpen}
              className={clsx(
                'glossa-menu-item hover:bg-base-300 text-base-content cursor-pointer rounded-md p-1 py-[10px] pe-3',
                disabled && 'btn-disabled cursor-not-allowed text-neutral-content',
                buttonClass,
              )}
              title={tooltip ? tooltip : ''}
            >
              {buttonContent}
            </summary>
            {children}
          </details>
        </li>
      </ul>
    );
  }

  return (
    <div className='flex'>
      <button
        role={toggled === undefined ? 'menuitem' : 'menuitemcheckbox'}
        aria-checked={toggled}
        aria-disabled={disabled || undefined}
        aria-label={
          toggled !== undefined ? `${label} - ${toggled ? _('ON') : _('OFF')}` : undefined
        }
        aria-live={toggled === undefined ? 'polite' : 'off'}
        tabIndex={disabled ? -1 : 0}
        className={clsx(
          'glossa-menu-item hover:bg-base-300 text-base-content flex w-full flex-col items-center justify-center rounded-md p-1 py-[10px]',
          disabled && 'btn-disabled text-neutral-content',
          buttonClass,
        )}
        title={tooltip ? tooltip : ''}
        onClick={handleClick}
        disabled={disabled}
      >
        {buttonContent}
      </button>
      {siblings}
    </div>
  );
};

export default MenuItem;
