// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PolishPanel } from '@/components/project/polish-panel';
import { splitOriginal } from '@/lib/script/polish';
import { checkDuration } from '@/lib/script/duration';

afterEach(cleanup);

const script = splitOriginal('一段话。两段话。三段话。四段话。五段话。六段话。');
const result = (over = {}) => ({
  title: '两年半',
  script,
  report: checkDuration(script, 75),
  changes: [{ kind: '删' as const, what: '删了重复的「然后」' }, { kind: '错字' as const, what: '「在」改成「再」' }],
  questions: ['hermes 指的是什么？'],
  added: [],
  ...over,
});

describe('PolishPanel', () => {
  it('lists the polished beats, every change and what needs confirming', () => {
    render(<PolishPanel result={result()} useLabel="用润色版" keepLabel="保留原文" onUse={vi.fn()} onKeep={vi.fn()} />);
    expect(screen.getByText('钩子')).toBeTruthy();
    expect(screen.getByText('一段话。')).toBeTruthy();
    expect(screen.getByText('删：删了重复的「然后」')).toBeTruthy();
    expect(screen.getByText('错字：「在」改成「再」')).toBeTruthy();
    expect(screen.getByText('hermes 指的是什么？')).toBeTruthy();
    expect(screen.queryByText(/这几处是新加的/)).toBeNull();
  });
  it('flags added sentences and a film still over length', () => {
    const long = splitOriginal(Array.from({ length: 6 }, () => '字'.repeat(80) + '。').join(''));
    render(<PolishPanel result={result({ added: ['这句是模型自己加的内容哦'], script: long, report: checkDuration(long, 75) })} useLabel="用润色版" keepLabel="保留原文" onUse={vi.fn()} onKeep={vi.fn()} />);
    expect(screen.getByText('这几处是新加的，确认一下：')).toBeTruthy();
    expect(screen.getByText('这句是模型自己加的内容哦')).toBeTruthy();
    expect(screen.getByText('仍超出 13.5 秒')).toBeTruthy();
  });
  it('calls back on use and keep', () => {
    const onUse = vi.fn();
    const onKeep = vi.fn();
    render(<PolishPanel result={result()} useLabel="用润色版" keepLabel="保留原文" onUse={onUse} onKeep={onKeep} />);
    fireEvent.click(screen.getByText('用润色版'));
    fireEvent.click(screen.getByText('保留原文'));
    expect(onUse).toHaveBeenCalledTimes(1);
    expect(onKeep).toHaveBeenCalledTimes(1);
  });
});
