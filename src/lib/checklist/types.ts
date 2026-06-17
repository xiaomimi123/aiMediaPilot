export interface PublishChecklistState {
  reviewedHook: boolean;
  reviewedRetention: boolean;
  reviewedTitleCaption: boolean;
  reviewedCover: boolean;
  finalTitle: string;
  finalCoverNote: string;
  actionItemsAdopted: number[];
  rewrittenHook?: string;
  completedAt?: string;
}

const HOOK_SCORE_THRESHOLD = 70;

export function emptyChecklist(): PublishChecklistState {
  return {
    reviewedHook: false,
    reviewedRetention: false,
    reviewedTitleCaption: false,
    reviewedCover: false,
    finalTitle: '',
    finalCoverNote: '',
    actionItemsAdopted: [],
  };
}

export interface ReadyInput {
  state: PublishChecklistState;
  hookScore: number | null;
}

export function isReady({ state, hookScore }: ReadyInput): boolean {
  if (!state.reviewedHook) return false;
  if (!state.reviewedRetention) return false;
  if (!state.reviewedTitleCaption) return false;
  if (!state.reviewedCover) return false;
  if (state.finalTitle.trim().length === 0) return false;
  if (state.finalCoverNote.trim().length === 0) return false;
  if (state.actionItemsAdopted.length < 1) return false;

  // Conditional: 如果 hookScore 低于阈值, 必须填重写
  if (hookScore !== null && hookScore < HOOK_SCORE_THRESHOLD) {
    if (!state.rewrittenHook || state.rewrittenHook.trim().length === 0) return false;
  }

  return true;
}

export function needsHookRewrite(hookScore: number | null): boolean {
  return hookScore !== null && hookScore < HOOK_SCORE_THRESHOLD;
}
