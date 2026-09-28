import { describe, expect, it, vi } from 'vitest';
import { proofreadAgainst } from '@/lib/recording/proofread';
import type { StructuredLLM } from '@/lib/script/write';

describe('proofreadAgainst', () => {
  it('uses the given reference label and text', async () => {
    const call = vi.fn(async () => ({ result: { lines: ['被诗人余秀华点名表扬'] }, usage: {} }));
    const llm = { callStructured: call } as unknown as StructuredLLM;
    const r = await proofreadAgainst(llm, { label: '视频文案', text: '#余秀华说AI是普通人的诗' }, [{ startSec: 0, endSec: 2, text: '被诗人于秀华点名表扬' }]);
    expect(r.lines[0].text).toBe('被诗人余秀华点名表扬');
    const msg = (call.mock.calls[0] as unknown as [{ userMessage: { text: string }[] }])[0].userMessage[0].text;
    expect(msg).toContain('【视频文案】\n#余秀华说AI是普通人的诗');
  });
});
