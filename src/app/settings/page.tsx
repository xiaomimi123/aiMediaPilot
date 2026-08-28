import Link from 'next/link';
import { PageShell } from '@/components/layout/page-shell';
import { StatusDot } from '@/components/settings/primitives';
import { loadJson } from '@/lib/settings/load';

export const dynamic = 'force-dynamic';

/**
 * 设置中枢。
 *
 * 这一页在 v5 重建里一直是句「阶段 3 只搭骨架」—— 而后端的 persona / voice /
 * experiences / radar / ai / tts 六套接口早就建齐了。结果是这些档案只能靠直接
 * 改数据库来配, 而它们恰恰决定了写稿的质量: 定位空着 AI 就按通用爆款套路写,
 * 经历空着 AI 就只能说「这里需要一个什么样的材料」。
 *
 * 每一项**如实报配没配**, 而不是只给个链接。没配的东西看不见, 就永远不会去配。
 */
export default async function SettingsPage() {
  const [persona, voice, experiences, radar, ai, tts] = await Promise.all([
    loadJson<{ established: boolean; pillars: unknown[] }>('/api/v1/persona/profile'),
    loadJson<{ established: boolean }>('/api/v1/voice/profile'),
    loadJson<{ experiences: unknown[] }>('/api/v1/experiences'),
    loadJson<{ hasKey: boolean; enabled: boolean }>('/api/v1/radar/config'),
    loadJson<{ id: string }[]>('/api/v1/ai/config'),
    loadJson<{ hasConfig: boolean }>('/api/v1/tts/volc-config'),
  ]);

  const expCount = experiences?.experiences.length ?? 0;
  const aiCount = ai?.length ?? 0;

  const sections = [
    {
      href: '/settings/persona',
      title: '账号定位',
      body: '你在对谁说话、反复讲什么、不碰什么。注入雷达打分、选题和写稿。',
      ok: persona?.established ?? false,
      status: persona?.established
        ? `已建立 · ${persona.pillars.length} 条支柱`
        : '未建立 —— 空着的时候 AI 只能按通用爆款套路写',
    },
    {
      href: '/settings/voice',
      title: '我的口吻',
      body: '来路、身份、立场、情绪基调。定位能被同行抄走，口吻抄不走。',
      ok: voice?.established ?? false,
      status: voice?.established ? '已建立' : '未建立 —— 缺「你是谁」时不会注入写稿',
    },
    {
      href: '/settings/experiences',
      title: '个人经历',
      body: '写稿时唯一被当作「你本人真有的材料」的来源。',
      ok: expCount > 0,
      status: expCount > 0 ? `${expCount} 条` : '空 —— AI 只能说「这里需要什么材料」，填不进真东西',
    },
    {
      href: '/settings/radar',
      title: '雷达',
      body: '关键词与抓取配置。选题栏里出现什么由这里决定。',
      ok: (radar?.hasKey ?? false) && (radar?.enabled ?? false),
      status: !radar?.hasKey
        ? '没有 Tavily Key —— 雷达和联网研究都跑不了'
        : radar.enabled
          ? '已开启'
          : '有 Key，但抓取是关的',
    },
    {
      href: '/settings/ai',
      title: '模型与密钥',
      body: '写稿、拆解、出片都靠它。每条都能当场测连通。',
      ok: aiCount > 0,
      status: aiCount > 0
        ? `${aiCount} 个模型${tts?.hasConfig ? ' · 语音合成已配' : ' · 语音合成未配'}`
        : '没有可用模型 —— 生成类功能全都跑不起来',
    },
  ];

  return (
    <PageShell
      title="设置"
      description="这几份档案决定 AI 写出来的东西像不像你。空着的项下面都写了空着的代价。"
    >
      <ul className="flex flex-col gap-2">
        {sections.map((s) => (
          <li key={s.href}>
            <Link
              href={s.href}
              className="block rounded-md border border-border bg-card p-4 transition-colors hover:border-foreground/30"
            >
              <div className="flex items-center gap-2">
                <StatusDot ok={s.ok} />
                <span className="font-serif-cn text-base font-semibold">{s.title}</span>
                <span
                  className={
                    s.ok
                      ? 'ml-auto text-xs text-muted-foreground'
                      : 'ml-auto text-xs text-destructive'
                  }
                >
                  {s.status}
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{s.body}</p>
            </Link>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
