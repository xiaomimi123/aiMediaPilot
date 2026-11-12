import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { screenrecInvocation } from '@/lib/film/screenrec';
import { CliError, needArg, type Command } from '../registry';

const STEP_LABEL: Record<string, string> = {
  record: '录屏完成（采集时间在 work/capture.json，核对后手填 sources）',
  voice: '配音完成',
  build: 'props 已生成',
  render: '渲染完成',
  verify: '校验完成（拼图要人看）',
  cleanup: '清理清单已列出（没有删除任何文件）',
};

export const SCREENREC_COMMANDS: Command[] = [
  {
    path: ['film', 'screenrec'],
    tier: 'heavy',
    hermes: false,
    usage: 'mp film screenrec <project.config.json> <record|voice|build|render|verify|cleanup>',
    summary: '产品录屏3D 出片',
    async run(_ctx, p) {
      const configPath = path.resolve(needArg(p, 0, 'project.config.json'));
      const step = needArg(p, 1, '步骤 record|voice|build|render|verify|cleanup');
      let inv: { cmd: string; args: string[] };
      try {
        inv = screenrecInvocation({
          repoRoot: process.cwd(),
          configPath,
          step,
          positionals: p.positionals.slice(2),
          flags: p.flags,
          python: process.env.PYTHON_BIN || 'python3',
          node: process.execPath,
        });
      } catch (e) {
        throw new CliError('bad_args', e instanceof Error ? e.message : String(e));
      }
      if (path.basename(inv.cmd) === 'tsx' && !fs.existsSync(inv.cmd)) throw new CliError('failed', '找不到 tsx，先在仓库根目录 npm install');
      const code = spawnSync(inv.cmd, inv.args, { cwd: process.cwd(), stdio: ['ignore', 2, 2], env: process.env }).status ?? 1;
      if (code !== 0) throw new CliError('failed', `产品录屏3D ${step} 失败（见上方输出）`);
      return { step, config: configPath };
    },
    format: (d) => STEP_LABEL[(d as { step: string }).step] ?? '完成',
  },
];
