import { describe, expect, it, vi, beforeEach } from 'vitest';
import { generateTodayScript, produceToday } from '@/lib/content-plan/actions';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('generateTodayScript', () => {
  const day = { topic: '选题A', angle: '角度A', hookDirection: '钩子A' };

  it('生成成功 + PATCH 成功 → syncFailed=false', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { scriptDraftId: 'draft1' } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: {} }));

    const result = await generateTodayScript({ planId: 'plan1', dayIndex: 1, day });

    expect(result).toEqual({ ok: true, scriptDraftId: 'draft1', syncFailed: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/scripts/generate');
    const genBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(genBody).toEqual({
      topic: '选题A',
      niche: 'ai-knowledge',
      platform: 'douyin',
      durationSec: 60,
      mode: 'full',
      materials: '角度: 角度A；钩子方向: 钩子A',
    });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/content-plans/plan1/days/1');
    const patchBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(patchBody).toEqual({ action: 'mark-scripted', scriptDraftId: 'draft1' });
  });

  it('生成成功但 PATCH 失败 → syncFailed=true 且带 scriptDraftId(不吞不卡死)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { scriptDraftId: 'draft1' } }))
      .mockResolvedValueOnce(jsonResponse({ success: false, message: '写入冲突' }, false, 500));

    const result = await generateTodayScript({ planId: 'plan1', dayIndex: 1, day });

    expect(result).toEqual({ ok: true, scriptDraftId: 'draft1', syncFailed: true });
  });

  it('生成本身失败 → ok:false 带 message', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: false, message: '生成失败: 超时' }, false, 500));

    const result = await generateTodayScript({ planId: 'plan1', dayIndex: 1, day });

    expect(result).toEqual({ ok: false, message: '生成失败: 超时' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('produceToday', () => {
  it('出片成功 + PATCH 成功 → syncFailed=false', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { videoProductionId: 'vp1' } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: {} }));

    const result = await produceToday({
      templateId: 'tmpl1',
      scriptDraftId: 'draft1',
      planId: 'plan1',
      dayIndex: 1,
    });

    expect(result).toEqual({ ok: true, videoProductionId: 'vp1', syncFailed: false });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/video-templates/tmpl1/produce');
    const prodBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(prodBody).toEqual({ scriptDraftId: 'draft1' });
    const patchBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(patchBody).toEqual({ action: 'mark-produced', videoProductionId: 'vp1' });
  });

  it('出片成功但 PATCH 失败 → syncFailed=true', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { videoProductionId: 'vp1' } }))
      .mockResolvedValueOnce(jsonResponse({}, false, 500));

    const result = await produceToday({
      templateId: 'tmpl1',
      scriptDraftId: 'draft1',
      planId: 'plan1',
      dayIndex: 1,
    });

    expect(result).toEqual({ ok: true, videoProductionId: 'vp1', syncFailed: true });
  });
});
