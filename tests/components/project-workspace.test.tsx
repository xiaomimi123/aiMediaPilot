// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectWorkspace } from '@/components/project/project-workspace';
import { toProjectView } from '@/lib/project/view';
import { SEGMENT_ROLES } from '@/lib/script/model';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const script = { segments: SEGMENT_ROLES.map((role, i) => ({ id: `s${i + 1}`, role, text: '字'.repeat(20) })) };
const base = { id: 'p1', stage: 'draft', targetSec: 60, script, updatedAt: new Date() };

describe('ProjectWorkspace', () => {
  it('title input follows the project after it is renamed server-side', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const renamed = toProjectView({ ...base, title: '让AI当杠精', stage: 'scripted' });
    // 定稿后工作区会刷新一次整包(为了拿到存进 Obsidian 的卡片)
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: { method?: string }) => ({ json: async () => ({ success: true, data: init?.method === 'PATCH' ? renamed : { project: renamed, messages: [] } }) })));
    render(<ProjectWorkspace initialProject={toProjectView({ ...base, title: '未命名项目' })} initialMessages={[]} />);
    fireEvent.click(screen.getByText('定稿'));
    await waitFor(() => expect((screen.getByDisplayValue('让AI当杠精') as HTMLInputElement).value).toBe('让AI当杠精'));
  });

  it('shows the save-to-Obsidian card right after finalizing', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const scripted = toProjectView({ ...base, title: 't', stage: 'scripted' });
    const card = { id: 'mNote', role: 'system', content: '要把这个项目存进 Obsidian 吗？', toolName: 'note:proposal', ok: true, proposalId: 'np1' };
    const proposal = { id: 'np1', projectId: 'p1', trigger: 'finalize', path: 'MediaPilot/项目/t.md', content: '# t', status: 'pending', error: null, createdAt: '2026-09-30T00:00:00.000Z' };
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => ({
      json: async () => ({
        success: true,
        data: url.startsWith('/api/notes/proposals/') ? proposal : init?.method === 'PATCH' ? scripted : { project: scripted, messages: [card] },
      }),
    })));
    render(<ProjectWorkspace initialProject={toProjectView({ ...base, title: 't' })} initialMessages={[]} />);
    fireEvent.click(screen.getByText('定稿'));
    await waitFor(() => expect(screen.getByText('存进 Obsidian')).toBeTruthy());
  });

  it('second turn: clears the previous turn highlight, keeps the new one after the reply text', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const turn = (seg: string) =>
      [
        { type: 'tool', name: 'patch_script', ok: true, summary: `改稿 ${seg}`, segmentIds: [seg] },
        { type: 'text', delta: `改好了 ${seg}` },
        { type: 'done' },
      ].map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
    const turns = [turn('s2'), turn('s4')];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { method?: string }) => {
      if (init?.method === 'POST') return new Response(turns.shift(), { status: 200, headers: { 'content-type': 'text/event-stream' } });
      return { json: async () => ({ success: true, data: { project: toProjectView({ ...base, title: 't' }), messages: [] } }) };
    }));
    render(<ProjectWorkspace initialProject={toProjectView({ ...base, title: 't' })} initialMessages={[]} />);
    const send = async (text: string, waitFor_: string) => {
      const box = screen.getByPlaceholderText(/和编导说点什么/) as HTMLTextAreaElement;
      await waitFor(() => expect(box.disabled).toBe(false));
      fireEvent.change(box, { target: { value: text } });
      fireEvent.keyDown(box, { key: 'Enter' });
      await waitFor(() => expect(screen.getByText(waitFor_)).toBeTruthy());
    };
    await send('改概念A', '改好了 s2');
    await send('改冷知识', '改好了 s4');
    await waitFor(() => {
      const marks = screen.queryAllByText('刚改');
      expect(marks).toHaveLength(1);
      expect(marks[0].parentElement?.textContent).toContain('冷知识');
    });
  });
  it('polls while a job runs, forwards the job notice to chat and switches to the recording tab when done', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const running = { id: 'j1', kind: 'transcribe', status: 'running', progress: 0.5, userMessage: '', errorDetail: null };
    const done = { ...running, status: 'done', progress: 1, userMessage: '转写完成：6 句' };
    const bundle = (jobs: unknown[], messages: unknown[]) => ({
      json: async () => ({ success: true, data: { project: toProjectView({ ...base, title: 't', stage: 'recorded' }), messages, recording: null, jobs } }),
    });
    const fetchMock = vi.fn(async () => bundle([done], [{ id: 'mJob', role: 'system', content: '转写完成：6 句', toolName: 'job:transcribe', ok: true }]));
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<ProjectWorkspace initialProject={toProjectView({ ...base, title: 't' })} initialMessages={[]} initialRecording={null} initialJobs={[running]} />);
    await vi.advanceTimersByTimeAsync(2100);
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByText('转写完成：6 句')).toBeTruthy());
    await waitFor(() => expect(screen.getByRole('tab', { name: '口播' }).getAttribute('aria-selected')).toBe('true'));
  });
  it('shows six steps and starts on the current one', () => {
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: false }) })));
    render(<ProjectWorkspace initialProject={toProjectView({ ...base, title: 't', stage: 'scripted' })} initialMessages={[]} />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent?.replace(/^✓\s*/, ''))).toEqual(['选题', '脚本', '口播', '成片', '发布', '复盘']);
    expect(screen.getByRole('tab', { name: '口播' }).getAttribute('aria-selected')).toBe('true');
  });
  it('opens the drawer once per new notice', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const card = { id: 'mNote', role: 'system', content: '要把这个项目存进 Obsidian 吗？', toolName: 'note:proposal', ok: true, proposalId: 'np1' };
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => ({
      json: async () => ({
        success: true,
        data: url.startsWith('/api/notes/proposals/')
          ? { id: 'np1', projectId: 'p1', trigger: 'finalize', path: 'MediaPilot/项目/t.md', content: '# t', status: 'pending', error: null, createdAt: '2026-09-30T00:00:00.000Z' }
          : init?.method === 'PATCH'
            ? toProjectView({ ...base, title: 't', stage: 'scripted' })
            : { project: toProjectView({ ...base, title: 't', stage: 'scripted' }), messages: [card] },
      }),
    })));
    render(<ProjectWorkspace initialProject={toProjectView({ ...base, title: 't' })} initialMessages={[]} />);
    expect(screen.queryByLabelText('收起对话')).toBeNull();
    fireEvent.click(screen.getByText('定稿'));
    await waitFor(() => expect(screen.getByLabelText('收起对话')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('收起对话'));
    // 同一条通知不会因为重新渲染再弹开
    fireEvent.click(screen.getByRole('tab', { name: '脚本' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByLabelText('收起对话')).toBeNull();
  });
  it('does not pop the drawer for notices that were already there when the page loaded', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const old = { id: 'mOld', role: 'system' as const, content: '转写完成：6 句', toolName: 'job:transcribe', ok: true };
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: { method?: string }) => ({
      json: async () => ({ success: true, data: init?.method === 'PATCH' ? toProjectView({ ...base, title: 't', stage: 'scripted' }) : { project: toProjectView({ ...base, title: 't', stage: 'scripted' }), messages: [old] } }),
    })));
    render(<ProjectWorkspace initialProject={toProjectView({ ...base, title: 't' })} initialMessages={[old]} />);
    fireEvent.click(screen.getByText('定稿'));
    await new Promise((r) => setTimeout(r, 80));
    expect(screen.queryByLabelText('收起对话')).toBeNull();
  });
  it('keeps marking the real current step after choosing another one', () => {
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: false }) })));
    render(<ProjectWorkspace initialProject={toProjectView({ ...base, title: 't', stage: 'scripted' })} initialMessages={[]} />);
    fireEvent.click(screen.getByRole('tab', { name: '脚本' }));
    expect(screen.getByRole('tab', { name: '口播' }).getAttribute('aria-current')).toBe('step');
    expect(screen.getByRole('tab', { name: '脚本' }).getAttribute('aria-selected')).toBe('true');
  });
});
