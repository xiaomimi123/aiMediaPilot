import { describe, expect, it } from 'vitest';
import post from '../../fixtures/douyin/post.json';
import profile from '../../fixtures/douyin/profile.json';
import search from '../../fixtures/douyin/search.json';
import { buildAccountScript, buildDetailScript, buildDownloadScript, buildSearchScript, createDouyinClient, WRITE_PATTERNS } from '@/lib/benchmark/douyin';
import { EgoUnavailableError, readResult } from '@/lib/ego';
import { DouyinRejectedError, DouyinLoginError } from '@/lib/benchmark/parse';

const SEC = 'MS4wLjABAAAAo9jpySaVTGscShEnsFnqUvUvrycnd8PaeJ8pORefn68';
const out = (v: unknown) => `noise\n@@RESULT@@${JSON.stringify(v)}\n`;

describe('douyin scripts', () => {
  it('only contain read calls', () => {
    for (const s of [buildAccountScript(SEC), buildDetailScript('7676819001574157481'), buildDownloadScript('7676819001574157481', '/tmp/x.mp4'), buildSearchScript('AI工具')]) {
      expect(s).not.toMatch(WRITE_PATTERNS);
      expect(s).toContain('@@RESULT@@');
    }
  });
  it('refuses ids that could break out of the script', () => {
    expect(() => buildAccountScript("x'); evil()")).toThrow();
    expect(() => buildDetailScript('12a')).toThrow();
  });
  it('uses the given task space so the nightly scan and the web do not share a page', () => {
    expect(buildAccountScript(SEC, '对标雷达-巡检')).toContain(JSON.stringify('对标雷达-巡检'));
    expect(buildAccountScript(SEC)).toContain(JSON.stringify('对标雷达'));
  });
  it('embeds the keyword as a JSON string', () => {
    expect(buildSearchScript('A"I')).toContain(JSON.stringify('A"I'));
  });
});

describe('createDouyinClient', () => {
  it('parses an account fetch', async () => {
    const c = createDouyinClient(async () => out({ profile: { status: 200, body: JSON.stringify(profile) }, post: { status: 200, body: JSON.stringify(post) } }));
    const r = await c.fetchAccount(SEC);
    expect(r.profile.nickname).toBe('园长说AI');
    expect(r.works.length).toBeGreaterThan(3);
  });
  it('turns a non-200 response into DouyinRejectedError', async () => {
    const c = createDouyinClient(async () => out({ profile: { status: 403, body: '' }, post: { status: 403, body: '' } }));
    await expect(c.fetchAccount(SEC)).rejects.toBeInstanceOf(DouyinRejectedError);
  });
  it('maps an ego failure to EgoUnavailableError', async () => {
    const c = createDouyinClient(async () => {
      throw new Error('退出码 1');
    });
    await expect(c.searchUsers('AI')).rejects.toBeInstanceOf(EgoUnavailableError);
  });
  it('parses search results', async () => {
    const c = createDouyinClient(async () => out({ status: 200, body: JSON.stringify(search) }));
    expect((await c.searchUsers('AI工具'))[0].nickname).toBe('AI课代表小明');
  });
  it('treats a non-JSON 200 as a lost login', async () => {
    const c = createDouyinClient(async () => out({ profile: { status: 200, body: '<html>登录</html>' }, post: { status: 200, body: '' } }));
    const e = await c.fetchAccount(SEC).catch((x) => x);
    expect(e).toBeInstanceOf(DouyinLoginError);
    expect(e.message).toContain('打开 ego lite 重新登录');
  });
  it('treats an empty work list from an account that has works as a lost login', async () => {
    const empty = { ...post, aweme_list: [], has_more: 0 };
    const c = createDouyinClient(async () => out({ profile: { status: 200, body: JSON.stringify(profile) }, post: { status: 200, body: JSON.stringify(empty) } }));
    await expect(c.fetchAccount(SEC)).rejects.toBeInstanceOf(DouyinLoginError);
  });
  it('readResult throws when the marker is missing', () => {
    expect(() => readResult('nothing here')).toThrow();
  });
});
