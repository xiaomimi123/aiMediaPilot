import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseSkill, listSkills, loadSkillTool, SKILLS_DIR } from '@/lib/assistant/skills';

const ctx = { projectId: '', db: {} as never, llm: {} as never };

describe('skills', () => {
  it('parses frontmatter and body', () => {
    expect(parseSkill('---\nname: daily-kickoff\ndescription: 每日开工\n---\n\n# 每日开工\n步骤')).toEqual({ name: 'daily-kickoff', description: '每日开工', body: '# 每日开工\n步骤' });
    expect(parseSkill('没有头')).toBeNull();
  });
  it('lists the three built-in skills', async () => {
    expect((await listSkills(SKILLS_DIR)).map((s) => s.name).sort()).toEqual(['benchmark-to-draft', 'daily-kickoff', 'data-diagnosis']);
  });
  it('loads a skill body', async () => {
    const r = await loadSkillTool(SKILLS_DIR).execute(ctx, { name: 'daily-kickoff' });
    expect(r.ok).toBe(true);
    expect(r.summary).toBe('已使用 skill：daily-kickoff');
    expect((r.data as { text: string }).text).toContain('status');
  });
  it('keeps every built-in skill within the per-turn tool budget', async () => {
    // 每轮最多 8 次工具(含 load_skill 本身); skill 步骤里写明的调用上限之和不能超
    for (const s of await listSkills(SKILLS_DIR)) {
      const body = (await loadSkillTool(SKILLS_DIR).execute(ctx, { name: s.name })).data as { text: string };
      const budget = Number(/工具预算：(\d+)/.exec(body.text)?.[1]);
      expect(budget, s.name).toBeLessThanOrEqual(7);
    }
  });
  it('lists skills when the name is unknown', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-sk-'));
    await fs.mkdir(path.join(dir, 'a'));
    await fs.writeFile(path.join(dir, 'a', 'SKILL.md'), '---\nname: a\ndescription: x\n---\nbody');
    const r = await loadSkillTool(dir).execute(ctx, { name: 'nope' });
    expect(r).toEqual({ ok: false, summary: '没有叫 nope 的 skill', data: { error: '可用的 skill：a' } });
  });
});
