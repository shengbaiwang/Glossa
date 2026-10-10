import { expect, it, vi } from 'vitest';
import { reviewEvidence } from './fixtures/evidenceReview';
import { evidenceCases } from './fixtures/evidenceCases';

const config = {
  id: 'evaluation',
  name: 'Evaluation',
  model: 'fixture',
  baseUrl: 'https://evaluation.example/v1',
};
it('keeps manual semantic expectations outside the review prompt and accepts only a complete receipt', async () => {
  const complete = vi.fn(async () =>
    JSON.stringify({
      results: evidenceCases.map(({ id, expected }) => ({ id, verdict: expected })),
    }),
  );
  const result = await reviewEvidence(
    evidenceCases,
    config,
    new AbortController().signal,
    complete,
  );
  expect(result).toHaveLength(evidenceCases.length);
  expect(complete.mock.calls).toHaveLength(1);
  const args = complete.mock.calls as unknown as [{ messages: { content: string }[] }][];
  expect(args[0]![0].messages[1]!.content).not.toContain('expected');
  expect(new Set(evidenceCases.map((item) => item.expected)).size).toBe(3);
});
it('rejects missing, duplicated and invented review IDs rather than reporting a quality score', async () => {
  for (const results of [
    [],
    [{ id: 'unknown', verdict: 'supported' }],
    [
      { id: evidenceCases[0].id, verdict: 'supported' },
      { id: evidenceCases[0].id, verdict: 'supported' },
    ],
  ])
    await expect(
      reviewEvidence(evidenceCases, config, new AbortController().signal, async () =>
        JSON.stringify({ results }),
      ),
    ).rejects.toThrow();
});
