export type ReviewResult = 'forgot' | 'hard' | 'good' | 'easy';

export interface WordMemoryState {
  wordId: string;
  stage: number;
  stabilityMinutes: number;
  firstLearnedAt: Date;
  lastReviewedAt: Date;
  nextReviewAt: Date | null;
  reviewCount: number;
  correctStreak: number;
  lapseCount: number;
  lastResult: ReviewResult | null;
  shortDeadlineReviewAts: Date[];
}

export interface ScheduleReviewInput {
  currentState: WordMemoryState;
  result: ReviewResult;
  reviewedAt: Date;
  deadline: Date;
}

export interface ScheduleReviewOutput {
  updatedState: WordMemoryState;
  estimatedRetentionAtReview: number;
  normalIntervalMinutes: number;
  finalIntervalMinutes: number | null;
  wasCompressedByDeadline: boolean;
  wasAdjustedByShortDeadline: boolean;
}

export interface ReviewSchedulerConfig {
  readonly MILLISECONDS_PER_MINUTE: number;
  readonly DEFAULT_TARGET_RETENTION: number;
  readonly INITIAL_STABILITY_MINUTES: number;
  readonly MIN_STABILITY_MINUTES: number;
  readonly FIRST_REVIEW_DELAY_MINUTES: number;
  readonly MIN_REVIEW_GAP_MINUTES: number;
  readonly DEADLINE_REVIEW_RATIO: number;
  readonly SHORT_DEADLINE_THRESHOLD_MINUTES: number;
  readonly SHORT_DEADLINE_REVIEW_RATIOS: readonly number[];
  readonly STABILITY_FACTORS: Readonly<Record<ReviewResult, number>>;
  readonly TARGET_RETENTION_BY_RESULT: Readonly<Record<'hard' | 'good' | 'easy', number>>;
  readonly REVIEW_RESULTS: readonly ReviewResult[];
}

export const config: ReviewSchedulerConfig;
export function calculateRetention(elapsedMinutes: number, stabilityMinutes: number): number;
export function calculateIntervalMinutes(stabilityMinutes: number, targetRetention: number): number;
export function calculateInitialReviewSchedule(learnedAt: Date, deadline: Date): Date[];
export function createInitialMemoryState(wordId: string, learnedAt: Date, deadline: Date): WordMemoryState;
export function scheduleNextReview(input: ScheduleReviewInput): ScheduleReviewOutput;
export function serializeMemoryState(state: WordMemoryState): Omit<WordMemoryState, 'firstLearnedAt' | 'lastReviewedAt' | 'nextReviewAt' | 'shortDeadlineReviewAts'> & {
  firstLearnedAt: string;
  lastReviewedAt: string;
  nextReviewAt: string | null;
  shortDeadlineReviewAts: string[];
};
export function deserializeMemoryState(value: object): WordMemoryState;
