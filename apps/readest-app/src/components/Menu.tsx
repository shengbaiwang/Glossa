import clsx from 'clsx';
import React, { useRef } from 'react';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';

interface MenuProps {
  children: React.ReactNode;
  role?: 'menu' | 'none';
  className?: string;
  style?: React.CSSProperties;
  onCancel?: () => void;
}

const Menu: React.FC<MenuProps> = ({ children, className, style, onCancel, role = 'none' }) => {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useKeyDownActions({ onCancel, elementRef: menuRef });

  const moveFocus = (event: React.KeyboardEvent) => {
    if (event.defaultPrevented || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key))
      return;
    if ((event.target as HTMLElement).matches('input, select, textarea, [contenteditable=true]'))
      return;
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>(
        'button[role^="menuitem"]:not([disabled]), details > summary[role="button"]:not([aria-disabled="true"])',
      ) ?? [],
    ).filter((item) => {
      const closedDetails = item.closest('details:not([open])');
      return !closedDetails || item.parentElement === closedDetails;
    });
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    const index =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : current < 0
            ? event.key === 'ArrowDown'
              ? 0
              : items.length - 1
            : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    event.preventDefault();
    event.stopPropagation();
    items[index]?.focus();
  };

  return (
    <div
      ref={menuRef}
      role={role}
      onKeyDownCapture={moveFocus}
      className={clsx(
        'menu-container max-h-[calc(100vh-96px)] overflow-y-auto border-0',
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
};

export default Menu;

export const MenuSeparator = () => <hr className='glossa-menu-separator' />;
