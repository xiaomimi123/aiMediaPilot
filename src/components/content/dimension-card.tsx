import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-amber-500">
      {'★'.repeat(rating)}{'☆'.repeat(5 - rating)}
    </span>
  );
}

export function DimensionCard({
  emoji, title, rating, children, error,
}: {
  emoji: string;
  title: string;
  rating?: number;
  children?: React.ReactNode;
  error?: string;
}) {
  return (
    <Card className={cn(error && 'border-destructive/40')}>
      <CardContent className="space-y-2 pt-6">
        <div className="flex items-center justify-between">
          <div className="font-semibold">{emoji} {title}</div>
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
