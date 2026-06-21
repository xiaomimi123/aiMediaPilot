import { Card, CardContent } from '@/components/ui/card';
import { X } from 'lucide-react';
import type { InsightOutput } from './types';

interface Props {
  data: InsightOutput;
  insightId: string | null;
  onClose: () => void;
}

export function InsightPanel({ data, insightId, onClose }: Props) {
  return (
    <Card className="border-2 border-purple-300 bg-purple-50/30">
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">🧠 AI 总结的共性 + 推荐 topic</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="折叠总结"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <Section title="📝 标题模式">
          <ul className="ml-4 list-disc space-y-1 text-sm">
            {data.titlePatterns.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </Section>

        <Section title="🪝 钩子类型分布">
          <div className="flex flex-wrap gap-1.5">
            {data.hookTypes.map((h, i) => (
              <span key={i} className="rounded bg-purple-100 px-2 py-0.5 text-xs text-purple-900">
                {h}
              </span>
            ))}
          </div>
        </Section>

        <Section title="⏱ 时长规律">
          <p className="text-sm">{data.durationInsight}</p>
        </Section>

        <Section title="📂 主题聚类">
          <div className="flex flex-wrap gap-1.5">
            {data.topicClusters.map((t, i) => (
              <span key={i} className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-900">
                {t}
              </span>
            ))}
          </div>
        </Section>

        <Section title="🚀 推荐你下一步可做的 topic">
          <ol className="space-y-3 text-sm">
            {data.recommendedTopics.map((t, i) => (
              <li key={i} className="border-b pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <p className="font-medium">
                      {i + 1}. {t.title}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{t.rationale}</p>
                  </div>
                  <a
                    href={`/agent?topic=${encodeURIComponent(t.title)}&platform=douyin${insightId ? `&inspirationId=${insightId}` : ''}`}
                    className="shrink-0 rounded-md bg-brand-gradient px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-opacity hover:opacity-90"
                  >
                    用这个生成 →
                  </a>
                </div>
              </li>
            ))}
          </ol>
        </Section>

        <Section title="📋 总结">
          <p className="whitespace-pre-wrap text-sm">{data.summary}</p>
        </Section>
      </CardContent>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h4 className="text-sm font-semibold text-muted-foreground">{title}</h4>
      {children}
    </div>
  );
}
