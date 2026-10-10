// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { splitOriginal } from '@/lib/script/polish';
import { checkDuration } from '@/lib/script/duration';
import { ScriptPane } from '@/components/project/script-pane';
import { toProjectView } from '@/lib/project/view';
import { SEGMENT_ROLES } from '@/lib/script/model';

const lengths = [30, 67, 67, 187, 67, 22];
const project = toProjectView({
  id: 'p1', title: '让AI当反方', stage: 'draft', targetSec: 60, updatedAt: new Date(),
  script: { segments: SEGMENT_ROLES.map((role, i) => ({ id: `s${i + 1}`, role, text: '字'.repeat(lengths[i]) })) },
});

// vitest 未开 globals, testing-library 不会自动清理, 手动清
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ScriptPane', () => {
  it('polishes a draft and replaces the script with the polished version', async () => {
    const polished = splitOriginal('甲。乙。丙。丁。戊。己。');
    const calls: { url: string; body?: unknown }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === '/api/scripts/polish') return { json: async () => ({ success: true, data: { title: 't', script: polished, report: checkDuration(polished, 60), changes: [{ kind: '删', what: '删了啰嗦的话' }], questions: [], added: [] } }) };
      return { json: async () => ({ success: false, message: 'x' }) };
    }));
    const onReplace = vi.fn(async () => {});
    render(<ScriptPane project={project} highlighted={new Set()} onEdit={vi.fn()} onFinalize={vi.fn()} onReplace={onReplace} />);
    fireEvent.click(screen.getByText('润色'));
    await waitFor(() => expect(screen.getByText('删：删了啰嗦的话')).toBeTruthy());
    expect(calls.find((c) => c.url === '/api/scripts/polish')?.body).toEqual({ text: project.script!.segments.map((s) => s.text).join('\n'), targetSec: 60 });
    fireEvent.click(screen.getByText('用润色版'));
    await waitFor(() => expect(onReplace).toHaveBeenCalledWith(polished, '稿子换成了润色版（改动 1 处：删了啰嗦的话）'));
    await waitFor(() => expect(screen.queryByText('删：删了啰嗦的话')).toBeNull());
  });

  it('keeps the polished version and the button usable when replacing fails', async () => {
    const polished = splitOriginal('甲。乙。丙。丁。戊。己。');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ json: async () => (url === '/api/scripts/polish' ? { success: true, data: { title: 't', script: polished, report: checkDuration(polished, 60), changes: [{ kind: '删', what: '删了啰嗦的话' }], questions: [], added: [] } } : { success: false, message: 'x' }) })));
    for (const onReplace of [vi.fn(async () => false), vi.fn(async () => { throw new Error('offline'); })]) {
      render(<ScriptPane project={project} highlighted={new Set()} onEdit={vi.fn()} onFinalize={vi.fn()} onReplace={onReplace} />);
      fireEvent.click(screen.getByText('润色'));
      fireEvent.click(await screen.findByText('用润色版'));
      await waitFor(() => expect(screen.getByText('没换成，润色稿还在下面，可以再点一次')).toBeTruthy());
      expect(screen.getByText('删：删了啰嗦的话')).toBeTruthy();
      expect((screen.getByText('用润色版') as HTMLButtonElement).disabled).toBe(false);
      expect((screen.getByText('润色') as HTMLButtonElement).disabled).toBe(false);
      cleanup();
    }
  });

  it('closes the polish panel when keeping the original', async () => {
    const polished = splitOriginal('甲。乙。丙。丁。戊。己。');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ json: async () => (url === '/api/scripts/polish' ? { success: true, data: { title: 't', script: polished, report: checkDuration(polished, 60), changes: [], questions: [], added: [] } } : { success: false, message: 'x' }) })));
    const onReplace = vi.fn();
    render(<ScriptPane project={project} highlighted={new Set()} onEdit={vi.fn()} onFinalize={vi.fn()} onReplace={onReplace} />);
    fireEvent.click(screen.getByText('润色'));
    fireEvent.click(await screen.findByText('保留原文'));
    expect(screen.queryByText('保留原文')).toBeNull();
    expect(onReplace).not.toHaveBeenCalled();
  });

  it('offers no polish after the script is finalized', () => {
    render(<ScriptPane project={{ ...project, stage: 'scripted' }} highlighted={new Set()} onEdit={vi.fn()} onFinalize={vi.fn()} onReplace={vi.fn()} />);
    expect(screen.queryByText('润色')).toBeNull();
  });

  it('shows total vs target and marks the over-limit segment in plain language', () => {
    render(<ScriptPane project={project} highlighted={new Set()} onEdit={vi.fn()} onFinalize={vi.fn()} />);
    expect(screen.getByText('约 88 秒 / 目标 60 秒')).toBeTruthy();
    expect(screen.getByText('怎么做的')).toBeTruthy();
    expect(screen.getByText('37.4 / 12 秒 · 偏长')).toBeTruthy();
  });

  it('marks highlighted segments as just changed', () => {
    render(<ScriptPane project={project} highlighted={new Set(['s2'])} onEdit={vi.fn()} onFinalize={vi.fn()} />);
    expect(screen.getAllByText('刚改').length).toBe(1);
  });

  it('shows an empty state when there is no script', () => {
    const empty = { ...project, script: null, report: null };
    render(<ScriptPane project={empty} highlighted={new Set()} onEdit={vi.fn()} onFinalize={vi.fn()} />);
    expect(screen.getByText('还没有稿子。在右边告诉编导这条想讲什么。')).toBeTruthy();
  });

  it('focuses the editor when a segment is clicked, so typing goes straight in', () => {
    render(<ScriptPane project={project} highlighted={new Set()} onEdit={vi.fn()} onFinalize={vi.fn()} />);
    fireEvent.click(screen.getAllByTitle('点击直接修改')[1]);
    expect(document.activeElement?.tagName).toBe('TEXTAREA');
  });
});
