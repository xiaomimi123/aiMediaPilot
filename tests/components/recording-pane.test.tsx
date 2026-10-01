// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RecordingPane } from '@/components/project/recording-pane';
import { toProjectView } from '@/lib/project/view';
import { SEGMENT_ROLES } from '@/lib/script/model';

afterEach(cleanup);
const script = { segments: SEGMENT_ROLES.map((role, i) => ({ id: `s${i + 1}`, role, text: `第${i + 1}段` })) };
const project = toProjectView({ id: 'p1', title: 't', stage: 'scripted', targetSec: 60, script, updatedAt: new Date() });
const noop = { onUploaded: vi.fn(), onRetry: vi.fn(async () => {}) };

describe('RecordingPane', () => {
  it('asks for a script first when there is none', () => {
    render(<RecordingPane project={{ ...project, script: null, report: null }} recording={null} job={null} {...noop} />);
    expect(screen.getByText('先在「脚本」里把稿子写出来，再来录。')).toBeTruthy();
  });

  it('offers the teleprompter and the upload area before anything is uploaded', () => {
    render(<RecordingPane project={project} recording={null} job={null} {...noop} />);
    expect(screen.getByText('打开提词器')).toBeTruthy();
    expect(screen.getByText('把录好的口播视频拖到这里，或点击选择（mp4 / mov）')).toBeTruthy();
  });

  it('shows progress while transcribing', () => {
    const job = { id: 'j1', kind: 'transcribe', status: 'running', progress: 0.42, userMessage: '', errorDetail: null };
    render(<RecordingPane project={project} recording={null} job={job} {...noop} />);
    expect(screen.getByText('正在转写… 42%')).toBeTruthy();
  });

  it('shows the plain-language failure with a retry button and a folded detail', () => {
    const onRetry = vi.fn(async () => {});
    const job = { id: 'j1', kind: 'transcribe', status: 'failed', progress: 0.1, userMessage: '本地转写没装好：缺 faster-whisper。', errorDetail: 'Traceback…' };
    render(<RecordingPane project={project} recording={null} job={job} onUploaded={vi.fn()} onRetry={onRetry} />);
    expect(screen.getByText('本地转写没装好：缺 faster-whisper。')).toBeTruthy();
    fireEvent.click(screen.getByText('重试'));
    expect(onRetry).toHaveBeenCalledWith('j1');
    expect(screen.getByText('详情')).toBeTruthy();
  });

  it('lists the transcript with adlib badges and skipped segments', () => {
    const recording = {
      videoFileId: 'f1',
      videoUrl: '/api/projects/p1/files/f1',
      durationSec: 79.2,
      transcript: {
        lines: [
          { startSec: 0, endSec: 2, text: '第1段', adlib: false },
          { startSec: 62, endSec: 64, text: '顺便说个题外话', adlib: true },
        ],
        skipped: ['冷知识'],
        proofread: 'done' as const,
      },
    };
    render(<RecordingPane project={project} recording={recording} job={null} {...noop} />);
    expect(screen.getByText('顺便说个题外话')).toBeTruthy();
    expect(screen.getAllByText('临场加的')).toHaveLength(1);
    expect(screen.getByText('没讲到：冷知识')).toBeTruthy();
    expect(screen.getByText('1:02')).toBeTruthy();
  });

  it('explains instead of silently ignoring a drop while a transcription is running', () => {
    const job = { id: 'j1', kind: 'transcribe', status: 'running', progress: 0.3, userMessage: '', errorDetail: null };
    render(<RecordingPane project={project} recording={null} job={job} {...noop} />);
    const zone = screen.getByText('把录好的口播视频拖到这里，或点击选择（mp4 / mov）');
    fireEvent.drop(zone, { dataTransfer: { files: [new File(['x'], 'a.mov')] } });
    expect(screen.getByText('上一个视频还在转写，等它完成再传。')).toBeTruthy();
  });

  it('disables 重试 while the retry request is in flight', () => {
    const job = { id: 'j1', kind: 'transcribe', status: 'failed', progress: 0, userMessage: '坏了', errorDetail: null };
    const onRetry = vi.fn(() => new Promise<void>(() => {}));
    render(<RecordingPane project={project} recording={null} job={job} onUploaded={vi.fn()} onRetry={onRetry} />);
    const btn = screen.getByText('重试') as HTMLButtonElement;
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(btn.disabled).toBe(true);
  });
});
