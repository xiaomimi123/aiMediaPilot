import type { ScriptAct } from "@/lib/script/six-act";

export interface ActGuideRow {
  act: ScriptAct;
  done: boolean;
}

export function buildActGuideRows(
  acts: ScriptAct[],
  progress: Record<string, boolean> | undefined,
): ActGuideRow[] {
  return acts.map((act) => ({ act, done: Boolean(progress?.[act.act]) }));
}
