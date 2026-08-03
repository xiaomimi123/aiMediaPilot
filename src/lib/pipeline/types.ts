import type { PipelineStage } from './stage';

export interface TopicCard {
  id: string; title: string; note: string | null; source: string; createdAt: string;
}

export interface ContentCard {
  id: string;
  kind: 'script' | 'analysis'; // analysis = 孤儿 ContentAnalysis (没链 script 的老数据)
  title: string;
  platform: string;            // script.platform; 孤儿 analysis 固定 'douyin'
  stage: PipelineStage;
  stageSince: string;          // 该阶段起点 ISO (卡片"停留天数"用)
  distributionCount: number;
  distributionPlatforms: string[];
  retroCountdownDays: number | null; // 仅 PUBLISHED: max(0, 3 - 已发天数) 取整; 其他 null
  detailUrl: string;           // script → /content/script/{id}; analysis → /content/preflight/{id}
}

export interface WorkbenchData {
  counts: { pool: number; drafting: number; ready: number; shot: number; published: number; retroed: number };
  topicPool: TopicCard[];
  columns: {
    drafting: ContentCard[]; ready: ContentCard[]; shot: ContentCard[];
    published: ContentCard[]; retroed: ContentCard[];
  };
}
