'use client';

import React from 'react';
import { GLOSSA_SOURCE_URL } from '@/services/constants';

interface PageFooterProps {
  tagline: string;
}

export const PageFooter: React.FC<PageFooterProps> = ({ tagline }) => (
  <p className='text-base-content/50 mt-6 text-center text-xs'>
    <a
      href={GLOSSA_SOURCE_URL}
      className='hover:text-base-content/80 font-medium transition-colors'
      target='_blank'
      rel='noopener noreferrer'
    >
      Glossa
    </a>
    <span className='mx-1.5'>·</span>
    <span>{tagline}</span>
  </p>
);
