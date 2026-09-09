import { useTranslation } from '@/hooks/useTranslation';
import type { ChapterSource } from '@/glossa/context/types';
import type { StudyNoteBody, StudyParagraph } from '@/glossa/notes/types';

interface Props {
  note: StudyNoteBody;
  sources: ChapterSource[];
  onSource: (source: ChapterSource) => void;
}

/** Render model text as text, with locally resolved reference buttons. No model HTML or links. */
export default function StudyNoteDocument({ note, sources, onSource }: Props) {
  const _ = useTranslation();
  const references = (ids: string[]) => (
    <span className='glossa-study-references'>
      {ids.map((id) => {
        const index = sources.findIndex((source) => source.sourceId === id);
        const source = sources[index];
        if (!source) return null;
        return (
          <button
            key={id}
            type='button'
            className='glossa-study-reference'
            title={_('View source {{number}}', { number: index + 1 })}
            aria-label={_('View source {{number}}', { number: index + 1 })}
            onClick={() => onSource(source)}
          >
            {index + 1}
          </button>
        );
      })}
    </span>
  );
  const paragraph = (item: StudyParagraph, index: number) => (
    <p key={index}>
      {item.kind === 'inference' && (
        <span className='glossa-study-inference'>{_('Inference')}</span>
      )}
      {item.text}
      {references(item.sourceIds)}
    </p>
  );

  return (
    <article className='glossa-study-document select-text' aria-label={_('Generated study note')}>
      <h3>{note.title}</h3>
      {note.insufficientEvidence && (
        <p role='status'>
          {_('The chapter does not contain enough evidence for a complete study note.')}
        </p>
      )}
      {note.overview.map(paragraph)}
      {note.sections.map((section, index) => (
        <section key={index}>
          <h4>{section.heading}</h4>
          {section.paragraphs.map(paragraph)}
        </section>
      ))}
      {note.questions.length > 0 && (
        <section className='glossa-study-questions'>
          <h4>{_('Check your understanding')}</h4>
          <p className='glossa-study-muted'>
            {_('Try answering before revealing the explanation.')}
          </p>
          {note.questions.map((question, index) => (
            <details key={index}>
              <summary>{question.question}</summary>
              <p>
                {question.answer}
                {references(question.sourceIds)}
              </p>
            </details>
          ))}
        </section>
      )}
    </article>
  );
}
