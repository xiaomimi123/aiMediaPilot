import fs from 'node:fs/promises';
import path from 'node:path';

/** 替换 KEY=... 这一行; 没有就追加。注释行(#)不算。其他行原样保留。 */
export function upsertEnvLine(content: string, key: string, value: string): string {
  const lines = content.split('\n');
  const i = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (i >= 0) {
    lines[i] = `${key}=${value}`;
    return lines.join('\n');
  }
  const base = content === '' || content.endsWith('\n') ? content : `${content}\n`;
  return `${base}${key}=${value}\n`;
}

/** 写 .env(临时文件 + rename, 不会写出半个文件), 并立即更新 process.env */
export async function writeEnvKey(key: string, value: string, file = path.join(process.cwd(), '.env')): Promise<void> {
  const content = await fs.readFile(file, 'utf8').catch(() => '');
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    await fs.writeFile(tmp, upsertEnvLine(content, key, value), { mode: 0o600 });
    await fs.rename(tmp, file);
  } catch (e) {
    await fs.unlink(tmp).catch(() => {}); // 临时文件里是完整 key, 失败也不留下
    throw e;
  }
  process.env[key] = value;
}
