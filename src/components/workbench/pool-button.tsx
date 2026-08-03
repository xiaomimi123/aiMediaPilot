'use client';

import { useState } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';

type PoolButtonState = 'idle' | 'busy' | 'done';

export interface PoolButtonProps {
  /** topic 标题, 会作为去重键 */
  title: string;
  /** 选题来源, 决定 POST /api/v1/topics 的 source 字段 */
  source: 'discover' | 'inspiration' | 'manual';
  /** 可选备注 (如 discover 的 hookLine + rationale), 一并写入选题池 */
  note?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  className?: string;
}

/**
 * 「+ 入选题池」按钮 — discover 页 topic 卡 与 agent 首页「灵感推荐」行共用。
 * 409 (已在池中) 与 2xx 都视为成功态, 展示「✓ 已入池」; 网络/其它错误退回 idle 允许重试。
 */
export function PoolButton({ title, source, note, variant = 'outline', size = 'sm', className }: PoolButtonProps) {
  const [state, setState] = useState<PoolButtonState>('idle');

  const addToPool = async () => {
    if (state !== 'idle') return;
    setState('busy');
    const res = await fetch('/api/v1/topics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, source, ...(note ? { note } : {}) }),
    }).catch(() => null);
    // 409 = 已在池中, 同样标记完成; 其它失败退回 idle 允许重试
    setState(res && (res.ok || res.status === 409) ? 'done' : 'idle');
  };

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={addToPool}
      disabled={state !== 'idle'}
      className={className}
    >
      {state === 'done' ? '✓ 已入池' : state === 'busy' ? '入池中…' : '+ 入选题池'}
    </Button>
  );
}
