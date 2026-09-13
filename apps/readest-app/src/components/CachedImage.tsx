'use client';
import { BookOpen } from '@/components/GlossaIcons';

import Image from 'next/image';
import { useState, useEffect, memo } from 'react';

interface CachedImageProps {
  src: string | null;
  alt: string;
  fill?: boolean;
  className?: string;
  sizes?: string;
  width?: number;
  height?: number;
  /**
   * Optional version tag for the image behind `src` (e.g. an OPDS entry's
   * Atom `<updated>` value). Caching is keyed by URL + version, so a server
   * that replaces the image at an unchanged URL and bumps the version gets a
   * fresh fetch instead of the stale cached copy (issue #5492).
   */
  cacheVersion?: string;
  onGenerateCachedImageUrl: (url: string, cacheVersion?: string) => Promise<string>;
  fallback?: React.ReactNode;
}

const imageUrlCache = new Map<string, string>();
const loadingPromises = new Map<string, Promise<string>>();

// '\n' cannot appear in a URL, so the key never collides with a plain URL key.
const toCacheKey = (src: string, cacheVersion?: string) =>
  cacheVersion ? `${src}\n${cacheVersion}` : src;

const CachedImageComponent = ({
  src,
  alt,
  fill,
  className,
  sizes,
  width,
  height,
  cacheVersion,
  onGenerateCachedImageUrl,
  fallback,
}: CachedImageProps) => {
  const [cachedUrl, setCachedUrl] = useState<string | null>(() => {
    return src ? imageUrlCache.get(toCacheKey(src, cacheVersion)) || null : null;
  });
  const [loading, setLoading] = useState(
    () => !src || !imageUrlCache.has(toCacheKey(src, cacheVersion)),
  );
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!src) {
      setTimeout(() => {
        setLoading(false);
      }, 0);
      return;
    }

    const cacheKey = toCacheKey(src, cacheVersion);
    const cached = imageUrlCache.get(cacheKey);
    if (cached) {
      setTimeout(() => {
        setCachedUrl(cached);
        setLoading(false);
      }, 0);
      return;
    }

    let cancelled = false;

    const loadImage = async () => {
      try {
        setLoading(true);
        setError(null);

        let loadPromise = loadingPromises.get(cacheKey);

        if (!loadPromise) {
          loadPromise = onGenerateCachedImageUrl(src, cacheVersion);
          loadingPromises.set(cacheKey, loadPromise);
          loadPromise.finally(() => {
            loadingPromises.delete(cacheKey);
          });
        }

        const url = await loadPromise;

        if (!cancelled) {
          imageUrlCache.set(cacheKey, url);
          setCachedUrl(url);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error('Failed to load image'));
          setLoading(false);
        }
      }
    };

    loadImage();

    return () => {
      cancelled = true;
    };
  }, [src, cacheVersion, onGenerateCachedImageUrl]);

  if (loading) {
    return (
      <div className={className}>
        <div className='bg-base-200 h-full w-full animate-pulse' />
      </div>
    );
  }

  if (error || !cachedUrl) {
    if (fallback) {
      return <>{fallback}</>;
    }
    return (
      <div className={`flex h-full w-full items-center justify-center ${className || ''}`}>
        <div className='text-base-content/30'>
          <BookOpen className='h-16 w-16' />
        </div>
      </div>
    );
  }

  if (fill) {
    return <Image src={cachedUrl} alt={alt} fill className={className} sizes={sizes} />;
  }

  return (
    <Image
      src={cachedUrl}
      alt={alt}
      width={width}
      height={height}
      className={className}
      sizes={sizes}
    />
  );
};

const arePropsEqual = (prevProps: CachedImageProps, nextProps: CachedImageProps) => {
  return (
    prevProps.src === nextProps.src &&
    prevProps.alt === nextProps.alt &&
    prevProps.fill === nextProps.fill &&
    prevProps.className === nextProps.className &&
    prevProps.sizes === nextProps.sizes &&
    prevProps.width === nextProps.width &&
    prevProps.height === nextProps.height &&
    prevProps.cacheVersion === nextProps.cacheVersion
  );
};

export const CachedImage = memo(CachedImageComponent, arePropsEqual);

export const clearImageCache = () => {
  imageUrlCache.clear();
  loadingPromises.clear();
};
