import fs from 'node:fs/promises';
import os from 'node:os';
import type { PrismaClient } from '@prisma/client';
import { LocalWhisperClient } from '@/lib/llm/local-whisper';
import { DeepSeekTextLLM } from '@/lib/llm/deepseek';
import { getDeepSeekKey } from '@/lib/env';
import { formatPersona, type PersonaLike } from '@/lib/tools/types';
import { createDouyinClient } from './douyin';
import { createPrismaStore } from './store';
import type { AnalyzeDeps } from './analyze';

export async function createAnalyzeDeps(db: PrismaClient): Promise<AnalyzeDeps> {
  const key = getDeepSeekKey();
  const persona = await db.personaProfile.findUnique({ where: { id: 'me' } });
  const whisper = new LocalWhisperClient();
  return {
    store: createPrismaStore(db),
    client: createDouyinClient(),
    transcribe: async (p) => (await whisper.transcribe(p)).segments.map((s) => ({ startSec: s.startSec, endSec: s.endSec, text: s.text })),
    llm: key ? new DeepSeekTextLLM({ apiKey: key }) : null,
    personaText: formatPersona(persona as PersonaLike | null),
    tmpDir: os.tmpdir(),
    removeFile: (p) => fs.unlink(p),
  };
}
