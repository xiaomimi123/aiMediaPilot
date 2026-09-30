// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Teleprompter, scrollSpeedPxPerSec } from '@/components/project/teleprompter';
import { SEGMENT_ROLES } from '@/lib/script/model';

afterEach(cleanup);
const script = { segments: SEGMENT_ROLES.map((role, i) => ({ id: `s${i + 1}`, role, text: `第${i + 1}段的口播内容` })) };

describe('scrollSpeedPxPerSec', () => {
  it('scrolls the whole height in totalChars / charsPerSec seconds', () => {
    expect(scrollSpeedPxPerSec(3000, 300, 5)).toBe(50);
    expect(scrollSpeedPxPerSec(0, 300, 5)).toBe(0);
    expect(scrollSpeedPxPerSec(3000, 0, 5)).toBe(0);
  });
});

describe('Teleprompter', () => {
  it('shows every segment and starts paused', () => {
    render(<Teleprompter script={script} onClose={vi.fn()} />);
    expect(screen.getByText('第4段的口播内容')).toBeTruthy();
    expect(screen.getByText('空格 开始')).toBeTruthy();
  });
  it('space toggles play/pause, arrows change speed, Esc closes', () => {
    const onClose = vi.fn();
    render(<Teleprompter script={script} onClose={onClose} />);
    fireEvent.keyDown(window, { key: ' ' });
    expect(screen.getByText('空格 暂停')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(screen.getByText('语速 6 字/秒')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
