/** One explicit paid call, original material only, no quality claim without human review. */
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { saveProviderConfig, validateProviderConfig } from '@/glossa/ai/provider';
import { evidenceCases } from './fixtures/evidenceCases';
import { reviewEvidence } from './fixtures/evidenceReview';

vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => false }));
vi.mock('@/utils/bridge', () => ({
  getSecureItem: vi.fn(),
  setSecureItem: vi.fn(),
  clearSecureItem: vi.fn(),
}));

it.skipIf(!process.env['GLOSSA_EVIDENCE_LIVE_CONFIG'])(
  'calibrates evidence review against twelve manually labelled original counterexamples',
  async () => {
    const config = validateProviderConfig(
      JSON.parse(readFileSync(process.env['GLOSSA_EVIDENCE_LIVE_CONFIG']!, 'utf8')),
    );
    const key = process.env['GLOSSA_EVIDENCE_LIVE_API_KEY'];
    if (!key) throw new Error('Explicit live acceptance requires an in-memory API key.');
    await saveProviderConfig(config, key);
    const started = Date.now();
    try {
      const result = await reviewEvidence(evidenceCases, config, AbortSignal.timeout(120000));
      const report = evidenceCases.map(({ id, expected }) => ({
        id,
        expected,
        actual: result.find((item) => item.id === id)!.verdict,
      }));
      const path = process.env['GLOSSA_EVIDENCE_LIVE_REPORT'];
      if (path)
        writeFileSync(
          path,
          JSON.stringify(
            { model: config.model, calls: 1, elapsedMs: Date.now() - started, report },
            null,
            2,
          ),
        );
      // This is a calibration gate for this fixed corpus, not proof of general correctness.
      expect(report.filter((item) => item.expected !== item.actual)).toEqual([]);
    } finally {
      localStorage.clear();
    }
  },
  125000,
);
