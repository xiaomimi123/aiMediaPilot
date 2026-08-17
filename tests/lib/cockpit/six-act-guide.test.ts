import { describe, expect, it } from "vitest";
import { buildActGuideRows } from "@/lib/cockpit/six-act-guide";
import type { ScriptAct } from "@/lib/script/six-act";

function makeAct(act: string, overrides: Partial<ScriptAct> = {}): ScriptAct {
  return {
    act: act as ScriptAct["act"],
    title: `title-${act}`,
    narration: `narration-${act}`,
    visual: `visual-${act}`,
    note: `note-${act}`,
    targetSec: 10,
    beats: [],
    facts: [],
    ...overrides,
  };
}

describe("buildActGuideRows", () => {
  const acts = [
    makeAct("hook"),
    makeAct("context"),
    makeAct("body1"),
    makeAct("body2"),
    makeAct("climax"),
    makeAct("cta"),
  ];

  it("returns all six acts", () => {
    const rows = buildActGuideRows(acts, undefined);
    expect(rows).toHaveLength(6);
    expect(rows.map((row) => row.act.act)).toEqual([
      "hook",
      "context",
      "body1",
      "body2",
      "climax",
      "cta",
    ]);
  });

  it("marks all done:false when progress is undefined", () => {
    const rows = buildActGuideRows(acts, undefined);
    expect(rows.every((row) => row.done === false)).toBe(true);
  });

  it("maps partial progress to the correct acts", () => {
    const rows = buildActGuideRows(acts, { hook: true, climax: true });
    const byAct = Object.fromEntries(rows.map((row) => [row.act.act, row.done]));
    expect(byAct).toEqual({
      hook: true,
      context: false,
      body1: false,
      body2: false,
      climax: true,
      cta: false,
    });
  });

  it("ignores extra/nonexistent act keys in progress, producing no 7th row", () => {
    const rows = buildActGuideRows(acts, {
      hook: true,
      nonexistent: true,
      somethingElse: false,
    } as Record<string, boolean>);
    expect(rows).toHaveLength(6);
    expect(rows.find((row) => (row.act.act as string) === "nonexistent")).toBeUndefined();
  });
});
