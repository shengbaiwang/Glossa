import React from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { Download as HiArrowDownTray } from '@/components/GlossaIcons';

const DropIndicator: React.FC = () => {
  const _ = useTranslation();
  return (
    <>
      <div className='drag-overlay'></div>
      <div className='drop-indicator'>
        <div className='flex flex-col items-center justify-center'>
          <HiArrowDownTray className='h-12 w-12' />
          <p className='mt-2 font-medium'>{_('Drop to Import Books')}</p>
        </div>
      </div>
    </>
  );
};

export default DropIndicator;
