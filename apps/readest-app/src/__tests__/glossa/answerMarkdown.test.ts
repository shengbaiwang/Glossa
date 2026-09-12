import { expect, it } from 'vitest';
import { renderAnswerHtml } from '@/glossa/ui/answerMarkdown';

it('renders math and code while keeping raw HTML inert and unable to load remote media', () => {
  const root = document.createElement('div');
  root.innerHTML = renderAnswerHtml(
    [
      '$x^2$\n\n```html\n<b>literal</b>\n```',
      '<div style="background:url(https://example.com/track)">raw</div>',
      '<video src="https://example.com/track" autoplay></video>',
      '<svg><image href="https://example.com/track" /></svg>',
      '<button class="glossa-chat-code-copy">fake control</button>',
    ].join('\n\n'),
  );
  expect(root.querySelector('math')).not.toBeNull();
  expect(root.querySelector('pre code')?.textContent).toContain('<b>literal</b>');
  expect(root.querySelector('[style], video, svg, image, button')).toBeNull();
});
