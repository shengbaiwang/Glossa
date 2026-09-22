import { expect, it } from 'vitest';
import { mapDiagnosticSchema, MapOutputError } from '@/glossa/mindmap/diagnostics';
import { readDirectMap, readMapInventory, readMapOutput } from '@/glossa/mindmap/protocol';

it.each([
  ['format', '{'],
  ['structure', JSON.stringify({ PRIVATE_RESPONSE: 'PRIVATE_BODY' })],
  ['structure', JSON.stringify({ nodes: [], insufficientEvidence: false })],
])('reports %s without retaining raw output or arbitrary field names', (kind, raw) => {
  try {
    readMapOutput(raw, [{ sourceId: 'm1' }]);
    throw new Error('Accepted malformed output');
  } catch (error) {
    expect(error).toBeInstanceOf(MapOutputError);
    const diagnostic = (error as MapOutputError).diagnostic;
    expect(diagnostic.kind).toBe(kind);
    expect(mapDiagnosticSchema.safeParse(diagnostic).success).toBe(true);
    expect(JSON.stringify(diagnostic)).not.toContain('PRIVATE');
  }
});

it('rejects repeated coverage IDs and forged inventory sources without coercing them', () => {
  const sources = [{ sourceId: 'm1' }, { sourceId: 'm2' }];
  expect(() =>
    readMapInventory(JSON.stringify({ coveredSourceIds: ['m1', 'm1'], points: [] }), sources),
  ).toThrow(expect.objectContaining({ diagnostic: expect.objectContaining({ kind: 'coverage' }) }));
  expect(() =>
    readMapInventory(
      JSON.stringify({
        coveredSourceIds: ['m1', 'm2'],
        points: [{ text: 'claim', sourceIds: ['forged'] }],
      }),
      sources,
    ),
  ).toThrow(expect.objectContaining({ diagnostic: expect.objectContaining({ kind: 'sources' }) }));
});

it('accepts fenced JSON but never guesses a missing direct wrapper or coerces typed fields', () => {
  const response = { coveredSourceIds: ['m1'], map: { nodes: [], insufficientEvidence: true } };
  expect(
    readDirectMap('```json\n' + JSON.stringify(response) + '\n```', [{ sourceId: 'm1' }]),
  ).toEqual(response.map);
  expect(() => readDirectMap(JSON.stringify(response.map), [{ sourceId: 'm1' }])).toThrow(
    MapOutputError,
  );
  expect(() =>
    readMapOutput(JSON.stringify({ nodes: [], insufficientEvidence: 'true' }), [
      { sourceId: 'm1' },
    ]),
  ).toThrow(MapOutputError);
});
