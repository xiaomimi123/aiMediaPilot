import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import {
  CreatorVoiceSchema,
  EMPTY_VOICE,
  isVoiceEstablished,
  parseVoiceStances,
  type CreatorVoiceData,
} from '@/lib/persona/voice';

/**
 * 人物志读写 (十二期 T2)。
 *
 * GET: 无行时返回全空默认 + established:false (不 404 —— 前端表单要能直接渲染空态)。
 * PUT: 全量覆盖 upsert。这里**不**做十期 PersonaProfile PUT 那种「缺省保留」合并语义 ——
 * 人物志五个字段从一开始就由同一张卡完整提交, 不存在「老表单只发部分字段」的历史包袱,
 * 全量覆盖语义更简单也更符合直觉 (用户清空某字段就该真被清空)。
 */
export async function GET() {
  const user = await getOrCreateDefaultUser();
  const row = await prisma.creatorVoice.findUnique({ where: { userId: user.id } });
  const data: CreatorVoiceData = row
    ? {
        origin: row.origin,
        identity: row.identity,
        notIdentity: row.notIdentity,
        stances: parseVoiceStances(row.stances),
        energy: row.energy,
      }
    : EMPTY_VOICE;
  return ok({ ...data, established: isVoiceEstablished(data) });
}

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const parsed = CreatorVoiceSchema.safeParse(body);
  if (!parsed.success) return fail(`人物志数据不合法: ${parsed.error.message}`, 400);

  const user = await getOrCreateDefaultUser();
  const data = parsed.data;
  await prisma.creatorVoice.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data },
    update: { ...data },
  });
  return ok({ ...data, established: isVoiceEstablished(data) });
}
