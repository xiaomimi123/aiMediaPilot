import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

function Stars({ rating }: { rating: number }) {
  const clamped = Math.max(1, Math.min(5, Math.round(rating)));
  return (
    <span className="text-amber-500">
      {'★'.repeat(clamped)}{'☆'.repeat(5 - clamped)}
    </span>
  );
}

export function DimensionCard({
  title, rating, children, error,
}: {
  title: string;
  rating?: number;
  children?: React.ReactNode;
  error?: string;
}) {
  return (
    <Card className={cn('border-[var(--line)] bg-[var(--panel-bg)]', error && 'border-destructive/40')}>
      <CardContent className="space-y-2 pt-6">
        <div className="flex items-center justify-between">
          <div className="font-semibold">{title}</div>
          {rating !== undefined && <Stars rating={rating} />}
        </div>
        {error ? (
          <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">⚠ {error}</div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}
