import React from 'react';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';
import { syncOrigin } from '@/glossa/sync/config';

export default function CloudHeadPreview({
  bookKey,
  children,
}: {
  bookKey: string;
  children: React.ReactNode;
}) {
  const preview = useReaderStore((s) => s.viewStates[bookKey]?.headPreview);
  const subject = useLibraryStore((s) => s.cloudSubject);
  const row = useLibraryStore((s) => s.getBookByHash(bookKey.split('-')[0]!));
  if (
    !preview ||
    row?.deletedAt ||
    row?.glossaDiscovery?.available === false ||
    row?.glossaCloud?.manifest_id !== preview.manifest ||
    preview.subject !== subject ||
    row.glossaCloud.subject !== subject ||
    row.glossaCloud.origin !== preview.origin ||
    preview.origin !== syncOrigin()
  )
    return <>{children}</>;
  return (
    <article
      className='bg-base-100 text-base-content h-full w-full overflow-auto'
      aria-label={row.title}
    >
      {preview.content.format === 'epub' ? (
        <div
          className='mx-auto max-w-prose whitespace-pre-wrap px-6 py-8 font-serif leading-relaxed'
          dir='auto'
        >
          {preview.content.text}
        </div>
      ) : (
        preview.content.pages.map((src, i) => (
          <img
            className='mx-auto block max-h-full max-w-full object-contain'
            key={i}
            src={src}
            alt={row.title + ' · ' + (i + 1)}
          />
        ))
      )}
    </article>
  );
}
