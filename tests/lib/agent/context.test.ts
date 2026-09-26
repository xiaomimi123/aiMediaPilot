import { describe, expect, it } from 'vitest';
import { formatSystemPrompt, loadHistory } from '@/lib/agent/context';
import { SEGMENT_ROLES } from '@/lib/script/model';
import { createFakeDb } from '../../helpers/fake-db';

const lengths = [30, 67, 67, 187, 67, 22];
const script = { segments: SEGMENT_ROLES.map((role, i) => ({ id: `s${i + 1}`, role, text: '字'.repeat(lengths[i]) })) };

describe('formatSystemPrompt', () => {
  it('includes segment ids with est/limit seconds and current issues', () => {
    const p = formatSystemPrompt({ title: '让AI当反方', stage: 'draft', targetSec: 60, script, persona: null });
    expect(p).toContain('[s4] 冷知识（约 37.4 秒 / 上限 11.3 秒，超标）');
    expect(p).toContain('第4段「冷知识」约 37.4 秒');
    expect(p).toContain('write_script');
  });
  it('tells the model to name segments in Chinese, never by internal id', () => {
    const p = formatSystemPrompt({ title: 't', stage: 'draft', targetSec: 60, script: null, persona: null });
    expect(p).toContain('跟用户说话时用段落的中文名（如「冷知识」），不要说 s1、s4 这类编号');
  });
  it('forbids inventing first-person experiences', () => {
    const p = formatSystemPrompt({ title: 't', stage: 'draft', targetSec: 60, script: null, persona: null });
    expect(p).toContain('【待补：你的真实经历】');
  });
  it('says there is no script yet when script is null', () => {
    const p = formatSystemPrompt({ title: '未命名项目', stage: 'draft', targetSec: 60, script: null, persona: null });
    expect(p).toContain('还没有稿子');
  });
  it('includes persona text when present', () => {
    const p = formatSystemPrompt({
      title: 't', stage: 'draft', targetSec: 60, script: null,
      persona: { audience: '职场新人', targetFans: '', pillars: [], angle: '', avoid: '不卖课', painPoints: [], offerings: [], systemSummary: '' },
    });
    expect(p).toContain('目标受众：职场新人');
    expect(p).toContain('忌讳：不卖课');
  });
});

describe('loadHistory', () => {
  it('returns oldest-first, maps tool rows to assistant notes, drops system rows', async () => {
    const { db } = createFakeDb();
    await db.chatMessage.create({ data: { projectId: 'p1', role: 'user', content: '写一版' } });
    await db.chatMessage.create({ data: { projectId: 'p1', role: 'tool', content: '写稿：6 段，约 59.6 秒', toolName: 'write_script' } });
    await db.chatMessage.create({ data: { projectId: 'p1', role: 'system', content: '编导暂时连不上' } });
    await db.chatMessage.create({ data: { projectId: 'p1', role: 'assistant', content: '写好了' } });
    const h = await loadHistory(db, 'p1');
    expect(h).toEqual([
      { role: 'user', content: '写一版' },
      { role: 'assistant', content: '（已执行 write_script：写稿：6 段，约 59.6 秒）' },
      { role: 'assistant', content: '写好了' },
    ]);
  });
});
