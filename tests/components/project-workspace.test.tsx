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
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: true, data: renamed }) })));
    render(<ProjectWorkspace initialProject={toProjectView({ ...base, title: '未命名项目' })} initialMessages={[]} />);
    fireEvent.click(screen.getByText('定稿'));
    await waitFor(() => expect((screen.getByDisplayValue('让AI当杠精') as HTMLInputElement).value).toBe('让AI当杠精'));
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
    await waitFor(() => expect(screen.getByRole('tab', { name: '② 口播' }).getAttribute('aria-selected')).toBe('true'));
  });
});
