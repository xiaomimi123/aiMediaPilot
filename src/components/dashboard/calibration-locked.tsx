import { Card, CardContent } from '@/components/ui/card';

export function CalibrationLocked({ sampleCount }: { sampleCount: number }) {
  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        <h3 className="font-semibold">🎯 AI 预判校准 (锁定中)</h3>
        <p className="text-sm text-muted-foreground">
          需要 ≥ 3 条 v2 复盘数据才能解锁。 你当前有 <b>{sampleCount}</b> 条已复盘。
        </p>
        <p className="text-xs text-muted-foreground">
          复盘 = 视频发到抖音后, 粘贴链接让 MediaPilot 拉真实播放数据, AI 自动算落差。
        </p>
      </CardContent>
    </Card>
  );
}
