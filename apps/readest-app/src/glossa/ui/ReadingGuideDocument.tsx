import { useTranslation } from '@/hooks/useTranslation';
import type { ChapterSource } from '@/glossa/context/types';
import type { GuideText, ReadingGuideBody } from '@/glossa/guide/types';

interface Props {
  guide: ReadingGuideBody;
  sources: ChapterSource[];
  onSource: (source: ChapterSource) => void;
}

function GuideParagraph({
  item,
  sources,
  onSource,
}: Pick<Props, 'sources' | 'onSource'> & { item: GuideText }) {
  const _ = useTranslation();
  return (
    <p dir='auto'>
      {item.kind !== 'source' && (
        <span className='glossa-guide-inference'>
          {_(item.kind === 'background' ? 'Background explanation' : 'Interpretation')}
        </span>
      )}
      {item.text}
      <span className='glossa-guide-references'>
        {item.kind === 'background' && (
          <span className='glossa-guide-related'>{_('Related passage')}</span>
        )}
        {item.sourceIds.map((id) => {
          const index = sources.findIndex((source) => source.sourceId === id);
          const source = sources[index];
          return source ? (
            <button
              key={id}
              type='button'
              className='glossa-guide-reference'
              aria-label={_(
                item.kind === 'background'
                  ? 'Related passage {{number}}'
                  : 'View source {{number}}',
                { number: index + 1 },
              )}
              onClick={() => onSource(source)}
            >
              {index + 1}
            </button>
          ) : null;
        })}
      </span>
    </p>
  );
}

export default function ReadingGuideDocument({ guide, sources, onSource }: Props) {
  const _ = useTranslation();
  return (
    <article className='glossa-guide-document select-text' aria-label={_('Generated guide')}>
      {guide.insufficientEvidence && (
        <p role='status'>{_('This passage does not contain enough evidence for a guide.')}</p>
      )}
      {guide.orientation.map((item, index) => (
        <GuideParagraph key={index} item={item} sources={sources} onSource={onSource} />
      ))}
      {guide.readingCue && (
        <section className='glossa-guide-cue'>
          <h3>{_('Reading cue')}</h3>
          <GuideParagraph item={guide.readingCue} sources={sources} onSource={onSource} />
        </section>
      )}
      {guide.difficulties.slice(0, 2).map((difficulty, index) => (
        <details key={index} className='glossa-guide-difficulty'>
          <summary dir='auto'>{difficulty.title}</summary>
          <GuideParagraph item={difficulty.explanation} sources={sources} onSource={onSource} />
        </details>
      ))}
    </article>
  );
}
