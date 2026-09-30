import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Tool } from '@/lib/tools/types';

export const SKILLS_DIR = path.join(process.cwd(), 'assistant', 'skills');

export interface SkillInfo {
  name: string;
  description: string;
  dir: string;
}

/** SKILL.md: YAML 头(name/description) + 正文; 格式与 Claude Code / Hermes 相同 */
export function parseSkill(text: string): { name: string; description: string; body: string } | null {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.trim());
  if (!m) return null;
  const field = (k: string) => new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(m[1])?.[1].trim().replace(/^["']|["']$/g, '') ?? '';
  const name = field('name');
  if (!name) return null;
  return { name, description: field('description'), body: m[2].trim() };
}

export async function listSkills(dir: string): Promise<SkillInfo[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: SkillInfo[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const text = await fs.readFile(path.join(dir, e.name, 'SKILL.md'), 'utf8').catch(() => null);
    const s = text ? parseSkill(text) : null;
    if (s) out.push({ name: s.name, description: s.description, dir: path.join(dir, e.name) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const Input = z.object({ name: z.string().min(1).describe('skill 名字(见系统提示里的清单)') });

export function loadSkillTool(dir: string): Tool<z.infer<typeof Input>> {
  return {
    name: 'load_skill',
    label: '读取 skill',
    description: '读取一个 skill 的完整步骤。做系统提示清单里列出的那类事之前先调用它，然后照着步骤做。',
    input: Input,
    async execute(_ctx, { name }) {
      const all = await listSkills(dir);
      const hit = all.find((s) => s.name === name);
      if (!hit) return { ok: false, summary: `没有叫 ${name} 的 skill`, data: { error: `可用的 skill：${all.map((s) => s.name).join('、') || '（无）'}` } };
      const s = parseSkill(await fs.readFile(path.join(hit.dir, 'SKILL.md'), 'utf8'))!;
      return { ok: true, summary: `已使用 skill：${s.name}`, data: { text: s.body } };
    },
  };
}
