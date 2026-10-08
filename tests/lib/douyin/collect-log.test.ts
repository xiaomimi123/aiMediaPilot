import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { parseCollectLog, readCollectStatus, parseRunLog, SCAN_SPEC, shouldSkipScheduled, shouldSkipScheduledCollect } from '@/lib/douyin/collect-log';

const now = new Date('2026-09-28T12:00:00Z');
const okRun = (d: string) => `[${d}T12:00:06.000Z] 开始回采\n[${d}T12:00:24.000Z] 回采完成: 共 101 条(新增 0 / 更新 101), 其中公开 5 条\n`;

describe('parseCollectLog', () => {
  it('is ok when the latest run completed recently', () => {
    const s = parseCollectLog(okRun('2026-09-27') + okRun('2026-09-28'), now);
    expect(s).toMatchObject({ state: 'ok', consecutiveFailures: 0, lastSuccessAt: '2026-09-28T12:00:24.000Z' });
  });
  it('counts consecutive failures and keeps the failure reason', () => {
    const text =
      okRun('2026-09-24') +
      "[2026-09-25T12:00:03.000Z] 开始回采\n[2026-09-25T12:00:24.000Z] 未预期的错误: PrismaClientInitializationError: \nCan't reach database server at `localhost:5432`\n    at $n.handleRequestError (/x.js:1:1)\n" +
      '[2026-09-26T12:00:02.000Z] 开始回采\n[2026-09-26T12:00:36.000Z] ego-browser 执行失败: 退出码 1\n[2026-09-26T12:00:36.100Z] 常见原因: ego lite 没在运行, 或抖音登录态已过期 —— 打开 ego lite 重新登录一次。\n';
    const s = parseCollectLog(text, now);
    expect(s.state).toBe('failing');
    expect(s.consecutiveFailures).toBe(2);
    expect(s.lastRun?.message).toBe('常见原因: ego lite 没在运行, 或抖音登录态已过期 —— 打开 ego lite 重新登录一次。');
    expect(s.hint).toContain('连续 2 次回采失败');
  });
  it('keeps the real reason of an unexpected error from the next stack line', () => {
    const text =
      okRun('2026-09-27') +
      "[2026-09-28T11:00:03.000Z] 开始回采\n[2026-09-28T11:00:24.000Z] 未预期的错误: PrismaClientInitializationError: \nCan't reach database server at `localhost:5432`\n    at $n.handleRequestError (/x.js:1:1)\n";
    const s = parseCollectLog(text, now);
    expect(s.lastRun?.message).toBe("未预期的错误：Can't reach database server at `localhost:5432`");
    expect(s.hint).toContain('docker compose up -d');
    expect(s.hint).not.toContain('PrismaClientInitializationError');
  });
  it('ignores npm noise and stack lines', () => {
    const text = 'shell-init: error retrieving current directory\n\n> mediapilot@0.1.0 collect:douyin\n> tsx scripts/collect-douyin.ts\n\n' + okRun('2026-09-28');
    expect(parseCollectLog(text, now).state).toBe('ok');
  });
  it('is stale when the last success is older than 36 hours', () => {
    const s = parseCollectLog(okRun('2026-09-26'), now);
    expect(s.state).toBe('stale');
    expect(s.hint).toContain('超过 36 小时没有成功回采');
    expect(s.hint).toContain('去「设置 · 每晚任务」');
    expect(s.hint).not.toContain('launchctl');
  });
  it('reports never-run when the log is missing', async () => {
    const s = await readCollectStatus(now, path.join(os.tmpdir(), 'definitely-missing.log'));
    expect(s.state).toBe('never');
    expect(s.hint).toContain('在「设置 · 每晚任务」开启每晚定时');
  });
});

describe('parseRunLog with the scan spec', () => {
  it('uses scan markers and wording', () => {
    const text = '[2026-09-28T11:30:00.000Z] 开始巡检\n[2026-09-28T11:31:00.000Z] 疑似触发风控，已停止(连续 3 个账号被拒)\n';
    const s = parseRunLog(text, now, SCAN_SPEC);
    expect(s.state).toBe('failing');
    expect(s.hint).toBe('连续 1 次对标巡检失败：疑似触发风控，已停止(连续 3 个账号被拒)');
  });
  it('is ok after a completed scan', () => {
    const text = '[2026-09-28T11:30:00.000Z] 开始巡检\n[2026-09-28T11:33:00.000Z] 巡检完成: 账号 3 个(失败 0) / 新作品 5 条 / 爆款 1 条 / 拆解 1 条\n';
    expect(parseRunLog(text, now, SCAN_SPEC).state).toBe('ok');
  });
});

describe('scheduled retry skip', () => {
  const now = new Date('2026-10-08T13:00:00.000Z');
  const ok = '[2026-10-08T12:00:00.000Z] 开始回采\n[2026-10-08T12:00:20.000Z] 回采完成: 共 101 条(新增 0 / 更新 101), 其中公开 5 条\n';
  const fail = '[2026-10-08T12:00:00.000Z] 开始回采\n[2026-10-08T12:00:20.000Z] ego-browser 执行失败: 退出码 1\n';
  it('skips a scheduled run when a collect succeeded within 6 hours', () => {
    expect(shouldSkipScheduledCollect(parseCollectLog(ok, now), now)).toBe(true);
    expect(shouldSkipScheduledCollect(parseCollectLog(ok, new Date('2026-10-08T18:01:00.000Z')), new Date('2026-10-08T18:01:00.000Z'))).toBe(false);
  });
  it('runs when the last collect failed or never ran', () => {
    expect(shouldSkipScheduledCollect(parseCollectLog(fail, now), now)).toBe(false);
    expect(shouldSkipScheduledCollect(parseCollectLog('', now), now)).toBe(false);
  });
  it('does not let the skip line change the status', () => {
    const skipped = ok + '[2026-10-08T13:00:01.000Z] 刚回采成功过（1 小时前），这次定时补跑跳过\n';
    expect(parseCollectLog(skipped, now)).toEqual(parseCollectLog(ok, now));
    const failThenSkip = fail + '[2026-10-08T13:00:01.000Z] 刚回采成功过（1 小时前），这次定时补跑跳过\n';
    expect(parseCollectLog(failThenSkip, now).state).toBe('failing');
  });
});

describe('scheduled scan skip', () => {
  it('skips a scheduled scan within 6 hours of a successful one', () => {
    const now = new Date('2026-10-08T13:30:00.000Z');
    const ok = '[2026-10-08T12:30:00.000Z] 开始巡检\n[2026-10-08T12:31:00.000Z] 巡检完成: 账号 3 个(失败 0) / 新作品 0 条 / 爆款 0 条 / 拆解 0 条\n';
    expect(shouldSkipScheduled(parseRunLog(ok, now, SCAN_SPEC), now)).toBe(true);
    expect(shouldSkipScheduled(parseRunLog('', now, SCAN_SPEC), now)).toBe(false);
  });
});
