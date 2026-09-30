import type { AgentEvent } from './loop';

export function encodeSse(e: AgentEvent): string {
  return `data: ${JSON.stringify(e)}\n\n`;
}

/** 按 "\n\n" 切事件; 末尾不完整的一段原样留在 rest 里等下一块数据。 */
export function parseSseBuffer(buffer: string): { events: AgentEvent[]; rest: string } {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  const events = parts
    .map((p) => p.trim())
    .filter((p) => p.startsWith('data: '))
    .map((p) => JSON.parse(p.slice('data: '.length)) as AgentEvent);
  return { events, rest };
}
