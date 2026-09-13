import clsx from 'clsx';
import React from 'react';

type SectionTitleProps<T extends React.ElementType = 'h3'> = {
  /** Element/component to render. Defaults to `<h3>` for section dividers;
   *  pass `'label'` for form-field titles, `'div'`/`'span'` if no semantic
   *  heading is wanted. */
  as?: T;
  children: React.ReactNode;
  className?: string;
} & Omit<React.ComponentPropsWithoutRef<T>, 'as' | 'children' | 'className'>;

/**
 * Shared muted 12px group heading, medium weight without forced uppercase.
 * Caller owns external spacing; typography is defined in glossa-foundations.css.
 */
function SectionTitle<T extends React.ElementType = 'h3'>({
  as,
  children,
  className,
  ...rest
}: SectionTitleProps<T>) {
  const Tag = (as ?? 'h3') as React.ElementType;
  return (
    <Tag className={clsx('glossa-section-title ps-4', className)} {...rest}>
      {children}
    </Tag>
  );
}

export default SectionTitle;
