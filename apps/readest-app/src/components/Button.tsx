import clsx from 'clsx';
import React from 'react';
import { useEnv } from '@/context/EnvContext';
import { useLongPress } from '@/hooks/useLongPress';

interface ButtonProps
  extends Pick<React.AriaAttributes, 'aria-pressed' | 'aria-expanded' | 'aria-controls'> {
  icon: React.ReactNode;
  onClick: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}

const Button: React.FC<ButtonProps> = ({
  icon,
  onClick,
  onLongPress,
  disabled = false,
  label,
  className,
  ...ariaProps
}) => {
  const { appService } = useEnv();
  const { handlers } = useLongPress({ onTap: onClick, onLongPress }, [onClick, onLongPress]);
  const interactionProps =
    onLongPress && !disabled ? handlers : { onClick: disabled ? undefined : onClick };
  return (
    <button
      type='button'
      disabled={disabled}
      {...ariaProps}
      className={clsx(
        // 32px of icon is below the 44px mobile touch target (DESIGN.md), and
        // in the reader bars a miss falls through to the book and turns the
        // page (#5401), so every one of these carries the halo.
        'touch-target btn btn-ghost glossa-icon-button h-8 min-h-8 w-8 p-0',
        appService?.isMobileApp && 'hover:bg-transparent',
        disabled && 'cursor-default !bg-transparent opacity-50',
        className,
      )}
      title={label}
      aria-label={label}
      {...interactionProps}
    >
      {icon}
    </button>
  );
};

export default Button;
