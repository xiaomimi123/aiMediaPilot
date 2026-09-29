import { describe, expect, it, vi } from 'vitest';
import { generatePublishKit } from '@/lib/retro/publish-kit';
import type { StructuredLLM } from '@/lib/script/write';

describe('generatePublishKit', () => {
  it('passes script, persona and benchmark title pattern to the model', async () => {
    const call = vi.fn(async () => ({ result: { titles: ['a', 'b', 'c'], hashtags: ['#AI工具'], coverText: ['U盘干到第一'] }, usage: {} }));
    const kit = await generatePublishKit({ callStructured: call } as unknown as StructuredLLM, { scriptText: '稿子', personaText: '定位', benchmarkTitlePattern: '期数栏目化前缀' });
    expect(kit.titles).toHaveLength(3);
    const text = (call.mock.calls[0] as unknown as [{ userMessage: { text: string }[] }])[0].userMessage[0].text;
    expect(text).toContain('【定稿】\n稿子');
    expect(text).toContain('期数栏目化前缀');
  });
});
