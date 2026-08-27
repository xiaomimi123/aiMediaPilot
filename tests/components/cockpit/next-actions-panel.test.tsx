// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NextActionsPanel } from '@/components/cockpit/next-actions-panel';

const CONTENTS = [
  { id: 'a1', title: '一个月用AI赚了100万', stage: 'recording', platform: 'douyin', scriptDraftId: 'd1', updatedAt: '2026-08-27T00:00:00.000Z' },
  { id: 'a2', title: 'DeepSeek 涨价', stage: 'script', platform: 'douyin', scriptDraftId: null, updatedAt: '2026-08-26T00:00:00.000Z' },
];

afterEach(cleanup);

describe('NextActionsPanel', () => {
  it('列出待推进的内容, 标题可见', () => {
    render(<NextActionsPanel contents={CONTENTS as never} />);
    expect(screen.getByText('一个月用AI赚了100万')).toBeTruthy();
  });

  it('每条给出动词而不是阶段名 —— 回答"我该干什么"', () => {
    render(<NextActionsPanel contents={CONTENTS as never} />);
    expect(screen.getByText('去拍摄')).toBeTruthy();
    expect(screen.getByText('写稿')).toBeTruthy();
  });

  it('标题是可点的链接, 直接进详情页 —— 不用先想它在哪个看板', () => {
    render(<NextActionsPanel contents={CONTENTS as never} />);
    const link = screen.getByRole('link', { name: /一个月用AI赚了100万/ });
    expect(link.getAttribute('href')).toBe('/content/detail/a1');
  });

  it('一条都没有时给出空态, 不是空白', () => {
    render(<NextActionsPanel contents={[]} />);
    expect(screen.getByText(/都推进完了|没有/)).toBeTruthy();
  });

  it('已归档的不出现', () => {
    render(<NextActionsPanel contents={[{ ...CONTENTS[0], stage: 'archived' }] as never} />);
    expect(screen.queryByText('一个月用AI赚了100万')).toBeNull();
  });
});
