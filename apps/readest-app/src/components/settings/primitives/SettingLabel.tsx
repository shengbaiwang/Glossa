import clsx from 'clsx';
import React from 'react';

type SettingLabelProps<T extends React.ElementType = 'span'> = {
  /** Element/component to render. Defaults to `<span>`; pass `'label'` for
   *  form-field labels, `'div'` if needed. */
  as?: T;
  children: React.ReactNode;
  className?: string;
} & Omit<React.ComponentPropsWithoutRef<T>, 'as' | 'children' | 'className'>;

/**
 * Primary settings label, inheriting the 14px desktop / 16px narrow-screen
 * body size. Regular weight keeps dense multilingual rows readable.
 */
function SettingLabel<T extends React.ElementType = 'span'>({
  as,
  children,
  className,
  ...rest
}: SettingLabelProps<T>) {
  const Tag = (as ?? 'span') as React.ElementType;
  return (
    <Tag className={clsx('glossa-setting-label line-clamp-2', className)} {...rest}>
      {children}
    </Tag>
  );
}

export default SettingLabel;
