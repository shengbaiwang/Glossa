import React from 'react';
import { useThemeStore } from '@/store/themeStore';

export const RIBBON_BODY_HEIGHT = 34;
export const RIBBON_WIDTH = 18;
export const RIBBON_NOTCH_DEPTH = 6;

const Ribbon: React.FC = () => {
  const { safeAreaInsets } = useThemeStore();
  const height = (safeAreaInsets?.top || 0) + RIBBON_BODY_HEIGHT;

  // z-20 keeps the ribbon above the scrolled-mode `notch-area` mask (z-10 in
  // SectionInfo) so its upper safe-area half isn't covered.
  return (
    <div
      className='ribbon glossa-reader-ribbon pointer-events-none absolute top-0 z-20'
      aria-hidden='true'
      style={{
        width: RIBBON_WIDTH,
        height,
      }}
    >
      <svg
        width='100%'
        height='100%'
        preserveAspectRatio='none'
        viewBox={`0 0 ${RIBBON_WIDTH} ${height}`}
        xmlns='http://www.w3.org/2000/svg'
        shapeRendering='geometricPrecision'
        imageRendering='optimizeQuality'
      >
        <polygon
          fill='currentColor'
          points={`${RIBBON_WIDTH},${height} ${RIBBON_WIDTH / 2},${height - RIBBON_NOTCH_DEPTH} 0,${height} 0,0 ${RIBBON_WIDTH},0`}
        />
      </svg>
    </div>
  );
};

export default Ribbon;
