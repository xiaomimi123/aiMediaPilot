import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** 临时假库: 仓库公开, 测试绝不读真实笔记 */
export async function makeVault(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-vault-'));
  await fs.mkdir(path.join(root, '.obsidian'));
  for (const [rel, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), text);
  }
  return root;
}
