import { describe, it, expect } from 'vitest';
import {
  buildTtsManifest,
  durationOfAct,
  hashNarration,
  parseTtsManifest,
  ttsManifestMatches,
} from '@/lib/video-production/tts-manifest';
import type { ActKey } from '@/lib/script/six-act';

const acts = [
  { act: 'hook' as ActKey, narration: '第一句钩子。' },
  { act: 'concept_a' as ActKey, narration: '概念A的讲解。' },
];

describe('tts-manifest', () => {
  it('哈希一致 + voiceType 一致 → 可以复用', () => {
    const manifest = buildTtsManifest(acts, 'zh_female_vv_uranus_bigtts', {
      hook: 3000,
      concept_a: 4000,
    });
    expect(ttsManifestMatches(acts, manifest, 'zh_female_vv_uranus_bigtts')).toBe(true);
  });

  it('narration 改一字 → 哈希变化 → 重来', () => {
    const manifest = buildTtsManifest(acts, 'zh_female_vv_uranus_bigtts', {
      hook: 3000,
      concept_a: 4000,
    });
    const editedActs = [
      { act: 'hook' as ActKey, narration: '第一句钩子!' }, // 句号改成感叹号
      acts[1],
    ];
    expect(ttsManifestMatches(editedActs, manifest, 'zh_female_vv_uranus_bigtts')).toBe(false);
  });

  it('voiceType 变化 → 重来', () => {
    const manifest = buildTtsManifest(acts, 'zh_female_vv_uranus_bigtts', {
      hook: 3000,
      concept_a: 4000,
    });
    expect(ttsManifestMatches(acts, manifest, 'zh_male_other_bigtts')).toBe(false);
  });

  it('manifest 缺失(null/undefined) → 重来, 不抛错', () => {
    expect(ttsManifestMatches(acts, null, 'v')).toBe(false);
    expect(ttsManifestMatches(acts, undefined, 'v')).toBe(false);
  });

  it('manifest 文件内容损坏(parseTtsManifest 解析失败) → 重来, 不抛错', () => {
    expect(parseTtsManifest('{not valid json')).toBeNull();
    expect(parseTtsManifest('{"entries": "not-an-array"}')).toBeNull();
    expect(ttsManifestMatches(acts, parseTtsManifest('garbage'), 'v')).toBe(false);
  });

  it('幕数量对不上(比如稿子加了一幕) → 重来', () => {
    const manifest = buildTtsManifest([acts[0]], 'v', { hook: 1000 });
    expect(ttsManifestMatches(acts, manifest, 'v')).toBe(false);
  });

  it('durationOfAct 直接从清单读值, 不需要重新探测', () => {
    const manifest = buildTtsManifest(acts, 'v', { hook: 3000, concept_a: 4000 });
    expect(durationOfAct(manifest, 'hook' as ActKey)).toBe(3000);
    expect(durationOfAct(manifest, 'concept_a' as ActKey)).toBe(4000);
    expect(durationOfAct(manifest, 'punchline' as ActKey)).toBeNull();
  });

  it('hashNarration 对相同文本稳定输出同一哈希', () => {
    expect(hashNarration('同一句话')).toBe(hashNarration('同一句话'));
    expect(hashNarration('同一句话')).not.toBe(hashNarration('不同一句话'));
  });

  it('parseTtsManifest 能往返读回 buildTtsManifest 写出的 JSON', () => {
    const manifest = buildTtsManifest(acts, 'v', { hook: 3000, concept_a: 4000 });
    const roundTripped = parseTtsManifest(JSON.stringify(manifest));
    expect(roundTripped).toEqual(manifest);
    expect(ttsManifestMatches(acts, roundTripped, 'v')).toBe(true);
  });
});
