/** Explicit opt-in, original material only. See docs/design/mindmap-reliability.md. */
import { readFileSync, writeFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { saveProviderConfig, streamCompletion, validateProviderConfig } from '@/glossa/ai/provider';
import type { ChapterSource } from '@/glossa/context/types';
import { generateOverviewMap } from '@/glossa/mindmap/explore';
import {
  mapCheckpointSchema,
  type MapCheckpoint,
  type MapCheckpointStore,
} from '@/glossa/mindmap/checkpoints';
import { validateSavedMindmap } from '@/glossa/mindmap/store';

vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => false }));
vi.mock('@/utils/bridge', () => ({
  getSecureItem: vi.fn(),
  setSecureItem: vi.fn(),
  clearSecureItem: vi.fn(),
}));

const cases = [
  {
    name: '灌溉试验的结论边界',
    kind: 'chapter' as const,
    paragraphs: [
      '栖谷试验只讨论一条支渠能否减少缺水，不能据此判断全县改革。三块自愿参加的试验田都有完好的闸门；结果不适用于闸门损坏的田。',
      '轮流放水之后，上游与下游收到水的时间差缩短。但当周恰好降雨，且没有未改革的对照田，因此只能说变化与新安排同时出现，不能证明新安排导致了改善。',
      '维护人员认为，轮流放水只有在闸门能够关闭、值守时间有记录且下游能提出异议时才可实行。三项条件必须同时满足，单有一份轮值表并不够。',
      '另有两块山坡田尝试同样的轮值表却未见改善，因为旧渠漏水严重。这是基础设施不同的反例，不能用来证明轮值在所有田地都无效。',
      '试验给值守家庭增加了夜间劳动，一位参与者因此反对扩大试验。支持者承认这一代价，提出先补偿夜间值守，再决定是否扩展；双方并未达成一致。',
      '报告最终只建议修好闸门、记录降雨并设置对照田后再做试验，没有建议立即推广，也没有认定轮值制度失败。下一轮须同时比较供水差距和劳动负担。',
    ],
    review:
      '保留三项同时成立的条件、降雨混杂不能证明因果、漏水反例的适用范围、劳动代价与分歧，以及先再试验而非立即推广。',
  },
  {
    name: 'Archive access under two rules',
    kind: 'chapter' as const,
    paragraphs: [
      'The town archive ran a four-week pilot. Researchers could request copies remotely only when the donor agreement allowed copying and the item had already been catalogued. These were joint requirements, not alternative routes.',
      'During the pilot, requests were answered sooner. Staffing also doubled in the same period. The report explicitly refused to attribute the shorter wait to remote access alone because it lacked a comparison group.',
      'A fragile uncatalogued diary remained available for supervised viewing. It was not eligible for remote copies. This exception to the viewing restriction was not an exception to either copying requirement.',
      'The public committee favoured expansion. The preservation team objected that copy preparation displaced conservation work. Neither group disputed the faster observed replies, but they disagreed about whether that benefit justified the workload.',
      'The report recommended a second limited pilot with recorded staffing and conservation hours. It did not recommend unrestricted remote access. A shorter wait and a lighter total workload were separate outcomes to be measured.',
    ],
    review:
      '保留复制的双重条件、查看与复制的区别、增员造成因果不确定性、两方分歧及有限试验的结论。',
  },
  {
    name: '两章中的开放与责任',
    kind: 'book' as const,
    paragraphs: [
      '第一章谈资料室。“开放”指居民能够查询已经去除姓名的统计汇总，不指公开个人登记表。个人登记表仍需本人同意后才能提供。',
      '资料员将汇总的计算方法一同公开，使居民能够复算。公开方法能帮助发现错误，但记录不全时无法据此证明每项统计正确。',
      '居民要求公布完整登记表，资料员拒绝，理由是可复算的汇总与可识别的个人资料属于不同对象。结论是增加可核查性，同时维持个人资料的同意条件。',
      '第二章谈水库。“开放”指汛期由管理员按预案开闸，不指公众自由操作闸门。达到警戒水位并完成下游通知是开闸的共同条件。',
      '提前开闸可能减少库区水位，但会增加下游流量。值班员主张只看库区水位，巡查员反对，要求同时核对下游承受能力；报告支持后者，未主张总是不开闸。',
      '全书结语指出，两章都把权限与可追溯的责任结合，但“开放”的具体对象、条件和风险不同。不能从资料汇总的公开推导水库应自由开闸，也不能把风险不同理解为两章毫无共同点。',
    ],
    review:
      '两章“开放”同名异义；资料同意/去名与可复算非绝对正确；开闸双条件、上下游风险和两方主张；共同责任不构成跨章因果。',
  },
];

it.skipIf(!process.env['GLOSSA_MAP_LIVE_CONFIG'])(
  'generates three original samples through the real provider for source-by-source review',
  async () => {
    vi.stubGlobal('crypto', webcrypto);
    const config = validateProviderConfig(
      JSON.parse(readFileSync(process.env['GLOSSA_MAP_LIVE_CONFIG']!, 'utf8')),
    );
    const apiKey = process.env['GLOSSA_MAP_LIVE_API_KEY'];
    if (!apiKey) throw new Error('An in-memory API key is required for the explicit live run.');
    await saveProviderConfig(config, apiKey);
    const report: object[] = [];
    let calls = 0;
    try {
      for (const sample of cases) {
        const sources: ChapterSource[] = sample.paragraphs.map((text, index) => ({
          sourceId: `original-${index + 1}`,
          text,
          kind: 'paragraph',
          anchor: {
            sectionIndex: index < 3 ? 0 : 1,
            cfi: `epubcfi(/6/${index < 3 ? 2 : 4}!/4/${2 + index * 2})`,
            quote: { exact: text, prefix: '', suffix: '' },
          },
        }));
        let checkpoint: MapCheckpoint | null = null,
          revision: string | null = null;
        const checkpoints: MapCheckpointStore = {
          load: async () => ({ checkpoint: structuredClone(checkpoint), revision }),
          save: async (_key, expected, value, signal) => {
            if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
            expect(expected).toBe(revision);
            checkpoint = structuredClone(mapCheckpointSchema.parse(value));
            revision = crypto.randomUUID();
            return revision;
          },
        };
        const started = Date.now();
        const map = await generateOverviewMap(
          {
            bookId: `original-live-${sample.name}`,
            title: sample.name,
            target:
              sample.kind === 'chapter'
                ? { kind: 'chapter', chapterId: 'original-chapter' }
                : { kind: 'book' },
            config,
            signal: AbortSignal.timeout(480000),
            restart: true,
            access: {
              documentHash: `original-live-${sample.name}`,
              chapters: [{ id: 'original-chapter', title: sample.name, depth: 0 }],
              readAll: async () => sources,
              readChapter: async () => sources,
              search: async () => [],
              verifySources: async (values) =>
                values.filter((value) =>
                  sources.some(
                    (source) => source.sourceId === value.sourceId && source.text === value.text,
                  ),
                ),
            },
          },
          {
            checkpoints,
            inventories: { load: async () => null, save: async () => {} },
            complete: async (request) => {
              if (++calls > 8) throw new Error('Live acceptance request cap reached.');
              return streamCompletion(request);
            },
          },
        );
        expect(await validateSavedMindmap(map)).not.toBeNull();
        expect(map.coverage?.sourceCount).toBe(sources.length);
        const saved = await checkpoints.load('');
        report.push({
          sample: sample.name,
          review: sample.review,
          model: config.model,
          elapsedMs: Date.now() - started,
          requests: saved.checkpoint?.requests,
          sources,
          nodes: map.nodes,
        });
      }
    } finally {
      // Only original fixtures and their maps go into this explicitly selected report.
      const path = process.env['GLOSSA_MAP_LIVE_REPORT'];
      if (path)
        writeFileSync(
          path,
          JSON.stringify({ complete: report.length === cases.length, calls, report }, null, 2),
        );
      localStorage.clear();
      vi.unstubAllGlobals();
    }
  },
  1440000,
);
