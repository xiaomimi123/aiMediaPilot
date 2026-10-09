// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ScriptPane } from '@/components/project/script-pane';
import { toProjectView } from '@/lib/project/view';
import { SEGMENT_ROLES } from '@/lib/script/model';

const lengths = [30, 67, 67, 187, 67, 22];
const project = toProjectView({
  id: 'p1', title: '让AI当反方', stage: 'draft', targetSec: 60, updatedAt: new Date(),
  script: { segments: SEGMENT_ROLES.map((role, i) => ({ id: `s${i + 1}`, role, text: '字'.repeat(lengths[i]) })) },
});

// vitest 未开 globals, testing-library 不会自动清理, 手动清
afterEach(cleanup);

describe('ScriptPane', () => {
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
