import { Card, CardContent } from '@/components/ui/card';

export function PredictionAccuracyLocked() {
  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        <h3 className="font-semibold">🎯 L1 预测精度 (锁定中)</h3>
        <p className="text-sm text-muted-foreground">
          需要 ≥ 1 条 &ldquo;有预测的复盘&rdquo; 才能解锁。 你当前: 0 条。
        </p>
        <p className="text-xs text-muted-foreground">
          预测 = 上传时 L1 算出的播放区间。 复盘 = 视频发布后, 粘抖音 URL 拉真实数据。
        </p>
      </CardContent>
    </Card>
  );
}
