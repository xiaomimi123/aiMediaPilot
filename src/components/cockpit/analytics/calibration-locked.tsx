export function CalibrationLocked({ sampleCount }: { sampleCount: number }) {
  return (
    <div className="space-y-2">
        <h3 className="font-semibold text-[var(--ink)]">🎯 AI 预判校准 (锁定中)</h3>
        <p className="text-sm text-[var(--muted)]">
          需要 ≥ 3 条 v2 复盘数据才能解锁。 你当前有 <b>{sampleCount}</b> 条已复盘。
        </p>
        <p className="text-xs text-[var(--muted)]">
          复盘 = 视频发到抖音后, 粘贴链接让 MediaPilot 拉真实播放数据, AI 自动算落差。
        </p>
      </div>
  );
}
