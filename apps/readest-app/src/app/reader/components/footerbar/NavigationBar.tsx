import clsx from 'clsx';
import React from 'react';
import {
  List as TOCIcon,
  SlidersHorizontal as SliderIcon,
  Type as FontIcon,
  Sun as ColorIcon,
} from '@/components/GlossaIcons';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSidebarStore } from '@/store/sidebarStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import Button from '@/components/Button';
import { Insets } from '@/types/misc';

interface NavigationBarProps {
  bookKey: string;
  actionTab: string;
  gridInsets: Insets;
  forceMobileLayout: boolean;
  onSetActionTab: (tab: string) => void;
}

export const NavigationBar: React.FC<NavigationBarProps> = ({
  actionTab,
  gridInsets,
  forceMobileLayout,
  onSetActionTab,
}) => {
  const isMobile = forceMobileLayout || window.innerWidth < 640 || window.innerHeight < 640;
  const _ = useTranslation();
  const { appService } = useEnv();

  const { isSideBarVisible, isSideBarPinned } = useSidebarStore();

  const tocIconSize = useResponsiveSize(18);
  const fontIconSize = useResponsiveSize(18);
  const navPadding = isMobile ? `${gridInsets.bottom * 0.33 + 16}px` : '0px';

  return (
    <div
      className={clsx(
        'not-eink:bg-base-200 eink:bg-base-100 z-30 mt-auto flex w-full justify-between px-8 py-4',
        'eink:border-base-content eink:border-t',
        !forceMobileLayout && 'sm:hidden',
      )}
      style={{
        paddingBottom: appService?.isAndroidApp
          ? `calc(env(safe-area-inset-bottom) + 16px)`
          : navPadding,
      }}
    >
      {isSideBarVisible && isSideBarPinned ? null : (
        <Button
          className='glossa-icon-button'
          label={_('Table of Contents')}
          icon={<TOCIcon size={tocIconSize} />}
          onClick={() => onSetActionTab('toc')}
        />
      )}
      <Button
        className='glossa-icon-button'
        label={_('Color')}
        aria-pressed={actionTab === 'color'}
        aria-expanded={actionTab === 'color'}
        icon={<ColorIcon size={18} aria-hidden='true' />}
        onClick={() => onSetActionTab('color')}
      />
      <Button
        className='glossa-icon-button'
        label={_('Reading Progress')}
        aria-pressed={actionTab === 'progress'}
        aria-expanded={actionTab === 'progress'}
        icon={<SliderIcon size={18} aria-hidden='true' />}
        onClick={() => onSetActionTab('progress')}
      />
      <Button
        className='glossa-icon-button'
        label={_('Font & Layout')}
        aria-pressed={actionTab === 'font'}
        aria-expanded={actionTab === 'font'}
        icon={<FontIcon size={fontIconSize} aria-hidden='true' />}
        onClick={() => onSetActionTab('font')}
      />
    </div>
  );
};
