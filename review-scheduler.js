// @ts-check
(function attachReviewScheduler(root, factory) {
  const config = typeof module === 'object' && module.exports
    ? require('./review-scheduler-config.js')
    : root.ReviewSchedulerConfig;
  const scheduler = factory(config);
  if (typeof module === 'object' && module.exports) module.exports = scheduler;
  if (root) root.ReviewScheduler = scheduler;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createReviewScheduler(config) {
  'use strict';

  if (!config) throw new Error('ReviewSchedulerConfig must be loaded before ReviewScheduler.');

  /** @typedef {'forgot' | 'hard' | 'good' | 'easy'} ReviewResult */
  /**
   * @typedef {Object} WordMemoryState
   * @property {string} wordId
   * @property {number} stage
   * @property {number} stabilityMinutes
   * @property {Date} firstLearnedAt
   * @property {Date} lastReviewedAt
   * @property {Date | null} nextReviewAt
   * @property {number} reviewCount
   * @property {number} correctStreak
   * @property {number} lapseCount
   * @property {ReviewResult | null} lastResult
   * @property {Date[]} shortDeadlineReviewAts
   */
  /**
   * @typedef {Object} ScheduleReviewInput
   * @property {WordMemoryState} currentState
   * @property {ReviewResult} result
   * @property {Date} reviewedAt
   * @property {Date} deadline
   */
  /**
   * @typedef {Object} ScheduleReviewOutput
   * @property {WordMemoryState} updatedState
   * @property {number} estimatedRetentionAtReview
   * @property {number} normalIntervalMinutes
   * @property {number | null} finalIntervalMinutes
   * @property {boolean} wasCompressedByDeadline
   * @property {boolean} wasAdjustedByShortDeadline
   */

  const {
    MILLISECONDS_PER_MINUTE,
    DEFAULT_TARGET_RETENTION,
    INITIAL_STABILITY_MINUTES,
    MIN_STABILITY_MINUTES,
    FIRST_REVIEW_DELAY_MINUTES,
    MIN_REVIEW_GAP_MINUTES,
    DEADLINE_REVIEW_RATIO,
    SHORT_DEADLINE_THRESHOLD_MINUTES,
    SHORT_DEADLINE_REVIEW_RATIOS,
    STABILITY_FACTORS,
    TARGET_RETENTION_BY_RESULT,
    REVIEW_RESULTS
  } = config;

  function assertFiniteNumber(value, name) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`${name} must be a finite number.`);
    }
  }

  function assertPositiveNumber(value, name) {
    assertFiniteNumber(value, name);
    if (value <= 0) throw new RangeError(`${name} must be greater than 0.`);
  }

  function assertNonNegativeInteger(value, name) {
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError(`${name} must be a non-negative integer.`);
    }
  }

  function assertValidDate(value, name) {
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new TypeError(`${name} must be a valid Date.`);
    }
  }

  function assertReviewResult(value) {
    if (!REVIEW_RESULTS.includes(value)) {
      throw new RangeError(`result must be one of: ${REVIEW_RESULTS.join(', ')}.`);
    }
  }

  function cloneDate(value) {
    return new Date(value.getTime());
  }

  function minutesBetween(later, earlier) {
    return (later.getTime() - earlier.getTime()) / MILLISECONDS_PER_MINUTE;
  }

  function addMinutes(date, minutes) {
    assertValidDate(date, 'date');
    assertPositiveNumber(minutes, 'minutes');
    const timestamp = date.getTime() + minutes * MILLISECONDS_PER_MINUTE;
    const result = new Date(timestamp);
    if (!Number.isFinite(result.getTime())) throw new RangeError('Calculated review date is invalid.');
    return result;
  }

  /**
   * Estimate how much of a word remains in memory after an elapsed duration.
   * @param {number} elapsedMinutes
   * @param {number} stabilityMinutes
   * @returns {number}
   */
  function calculateRetention(elapsedMinutes, stabilityMinutes) {
    assertFiniteNumber(elapsedMinutes, 'elapsedMinutes');
    if (elapsedMinutes < 0) throw new RangeError('elapsedMinutes must be at least 0.');
    assertPositiveNumber(stabilityMinutes, 'stabilityMinutes');
    const retention = Math.exp(-elapsedMinutes / stabilityMinutes);
    if (!Number.isFinite(retention)) throw new RangeError('Calculated retention is not finite.');
    return Math.min(1, Math.max(0, retention));
  }

  /**
   * Calculate when retention reaches a selected threshold.
   * @param {number} stabilityMinutes
   * @param {number} targetRetention
   * @returns {number}
   */
  function calculateIntervalMinutes(stabilityMinutes, targetRetention) {
    assertPositiveNumber(stabilityMinutes, 'stabilityMinutes');
    assertFiniteNumber(targetRetention, 'targetRetention');
    if (targetRetention <= 0 || targetRetention >= 1) {
      throw new RangeError('targetRetention must be greater than 0 and less than 1.');
    }
    const interval = -stabilityMinutes * Math.log(targetRetention);
    if (!Number.isFinite(interval) || interval <= 0) {
      throw new RangeError('Calculated interval must be a finite positive number.');
    }
    return Math.max(1, Math.round(interval));
  }

  /**
   * Build the first due dates. For deadlines under a day, retain two additional
   * checkpoints while respecting the minimum gap and removing duplicates.
   * @param {Date} learnedAt
   * @param {Date} deadline
   * @returns {Date[]}
   */
  function calculateInitialReviewSchedule(learnedAt, deadline) {
    assertValidDate(learnedAt, 'learnedAt');
    assertValidDate(deadline, 'deadline');
    const remainingMinutes = minutesBetween(deadline, learnedAt);
    if (remainingMinutes < 0) throw new RangeError('deadline cannot be earlier than learnedAt.');
    if (remainingMinutes <= MIN_REVIEW_GAP_MINUTES) return [];

    const offsets = [FIRST_REVIEW_DELAY_MINUTES];
    if (remainingMinutes < SHORT_DEADLINE_THRESHOLD_MINUTES) {
      offsets.push(...SHORT_DEADLINE_REVIEW_RATIOS.map(ratio => Math.round(remainingMinutes * ratio)));
    }

    const uniqueOffsets = [...new Set(offsets)]
      .filter(offset => offset >= MIN_REVIEW_GAP_MINUTES && offset <= remainingMinutes)
      .sort((a, b) => a - b);
    const acceptedOffsets = [];
    for (const offset of uniqueOffsets) {
      const previous = acceptedOffsets.at(-1) || 0;
      if (offset - previous >= MIN_REVIEW_GAP_MINUTES) acceptedOffsets.push(offset);
    }
    return acceptedOffsets.map(offset => addMinutes(learnedAt, offset));
  }

  /**
   * @param {string} wordId
   * @param {Date} learnedAt
   * @param {Date} deadline
   * @returns {WordMemoryState}
   */
  function createInitialMemoryState(wordId, learnedAt, deadline) {
    if (typeof wordId !== 'string' || !wordId.trim()) throw new TypeError('wordId must be a non-empty string.');
    assertValidDate(learnedAt, 'learnedAt');
    assertValidDate(deadline, 'deadline');
    const schedule = calculateInitialReviewSchedule(learnedAt, deadline);
    return {
      wordId: wordId.trim(),
      stage: 0,
      stabilityMinutes: INITIAL_STABILITY_MINUTES,
      firstLearnedAt: cloneDate(learnedAt),
      lastReviewedAt: cloneDate(learnedAt),
      nextReviewAt: schedule.length ? cloneDate(schedule[0]) : null,
      reviewCount: 0,
      correctStreak: 0,
      lapseCount: 0,
      lastResult: null,
      shortDeadlineReviewAts: schedule.slice(1).map(cloneDate)
    };
  }

  function validateMemoryState(state) {
    if (!state || typeof state !== 'object') throw new TypeError('currentState must be an object.');
    if (typeof state.wordId !== 'string' || !state.wordId.trim()) throw new TypeError('currentState.wordId must be a non-empty string.');
    assertNonNegativeInteger(state.stage, 'currentState.stage');
    assertPositiveNumber(state.stabilityMinutes, 'currentState.stabilityMinutes');
    assertValidDate(state.firstLearnedAt, 'currentState.firstLearnedAt');
    assertValidDate(state.lastReviewedAt, 'currentState.lastReviewedAt');
    if (state.nextReviewAt !== null) assertValidDate(state.nextReviewAt, 'currentState.nextReviewAt');
    assertNonNegativeInteger(state.reviewCount, 'currentState.reviewCount');
    assertNonNegativeInteger(state.correctStreak, 'currentState.correctStreak');
    assertNonNegativeInteger(state.lapseCount, 'currentState.lapseCount');
    if (state.lastResult !== null) assertReviewResult(state.lastResult);
    if (!Array.isArray(state.shortDeadlineReviewAts)) throw new TypeError('currentState.shortDeadlineReviewAts must be an array.');
    state.shortDeadlineReviewAts.forEach((date, index) => assertValidDate(date, `currentState.shortDeadlineReviewAts[${index}]`));
  }

  function targetRetentionFor(result) {
    return result === 'forgot' ? DEFAULT_TARGET_RETENTION : TARGET_RETENTION_BY_RESULT[result];
  }

  /**
   * Apply the exponential-forgetting model and deadline compression.
   * This function is deterministic and performs no UI or storage operations.
   * @param {ScheduleReviewInput} input
   * @returns {ScheduleReviewOutput}
   */
  function scheduleNextReview(input) {
    if (!input || typeof input !== 'object') throw new TypeError('input must be an object.');
    const {currentState, result, reviewedAt, deadline} = input;
    validateMemoryState(currentState);
    assertReviewResult(result);
    assertValidDate(reviewedAt, 'reviewedAt');
    assertValidDate(deadline, 'deadline');

    const elapsedMinutes = minutesBetween(reviewedAt, currentState.lastReviewedAt);
    if (elapsedMinutes < 0) throw new RangeError('reviewedAt cannot be earlier than lastReviewedAt.');
    const remainingMinutes = minutesBetween(deadline, reviewedAt);
    if (remainingMinutes < 0) throw new RangeError('deadline cannot be earlier than reviewedAt.');

    const estimatedRetentionAtReview = calculateRetention(elapsedMinutes, currentState.stabilityMinutes);
    const newStability = Math.max(
      MIN_STABILITY_MINUTES,
      currentState.stabilityMinutes * STABILITY_FACTORS[result]
    );
    if (!Number.isFinite(newStability)) throw new RangeError('Updated stability is not finite.');

    const targetRetention = targetRetentionFor(result);
    const curveInterval = calculateIntervalMinutes(newStability, targetRetention);
    const normalIntervalMinutes = result === 'forgot' ? FIRST_REVIEW_DELAY_MINUTES : curveInterval;
    let finalIntervalMinutes = null;
    let wasCompressedByDeadline = false;
    let wasAdjustedByShortDeadline = false;

    if (remainingMinutes > MIN_REVIEW_GAP_MINUTES) {
      if (normalIntervalMinutes <= remainingMinutes) {
        finalIntervalMinutes = Math.max(MIN_REVIEW_GAP_MINUTES, normalIntervalMinutes);
      } else {
        const compressedInterval = Math.floor(remainingMinutes * DEADLINE_REVIEW_RATIO);
        finalIntervalMinutes = Math.max(MIN_REVIEW_GAP_MINUTES, compressedInterval);
        wasCompressedByDeadline = true;
      }
      if (finalIntervalMinutes > remainingMinutes) finalIntervalMinutes = null;
    }

    const pendingShortReviews = currentState.shortDeadlineReviewAts
      .filter(date => minutesBetween(date, reviewedAt) >= MIN_REVIEW_GAP_MINUTES)
      .filter(date => date.getTime() <= deadline.getTime())
      .sort((a, b) => a.getTime() - b.getTime())
      .map(cloneDate);
    if (pendingShortReviews.length) {
      const protectedInterval = minutesBetween(pendingShortReviews[0], reviewedAt);
      if (finalIntervalMinutes === null || protectedInterval < finalIntervalMinutes) {
        finalIntervalMinutes = protectedInterval;
        wasAdjustedByShortDeadline = true;
      }
    }

    let nextReviewAt = null;
    if (finalIntervalMinutes !== null) {
      if (!Number.isFinite(finalIntervalMinutes) || finalIntervalMinutes < MIN_REVIEW_GAP_MINUTES) {
        throw new RangeError('Final interval must respect the minimum review gap.');
      }
      nextReviewAt = addMinutes(reviewedAt, finalIntervalMinutes);
      if (nextReviewAt.getTime() > deadline.getTime()) {
        nextReviewAt = null;
        finalIntervalMinutes = null;
      }
    }

    const isForgotten = result === 'forgot';
    const remainingShortReviews = nextReviewAt
      ? pendingShortReviews.filter(date => date.getTime() !== nextReviewAt.getTime())
      : pendingShortReviews;
    const updatedState = {
      wordId: currentState.wordId,
      stage: isForgotten ? Math.max(0, currentState.stage - 1) : currentState.stage + 1,
      stabilityMinutes: newStability,
      firstLearnedAt: cloneDate(currentState.firstLearnedAt),
      lastReviewedAt: cloneDate(reviewedAt),
      nextReviewAt,
      reviewCount: currentState.reviewCount + 1,
      correctStreak: isForgotten ? 0 : currentState.correctStreak + 1,
      lapseCount: currentState.lapseCount + (isForgotten ? 1 : 0),
      lastResult: result,
      shortDeadlineReviewAts: remainingShortReviews
    };

    return {
      updatedState,
      estimatedRetentionAtReview,
      normalIntervalMinutes,
      finalIntervalMinutes,
      wasCompressedByDeadline,
      wasAdjustedByShortDeadline
    };
  }

  /** Convert Date values to UTC ISO strings without performing storage I/O. */
  function serializeMemoryState(state) {
    validateMemoryState(state);
    return {
      ...state,
      firstLearnedAt: state.firstLearnedAt.toISOString(),
      lastReviewedAt: state.lastReviewedAt.toISOString(),
      nextReviewAt: state.nextReviewAt ? state.nextReviewAt.toISOString() : null,
      shortDeadlineReviewAts: state.shortDeadlineReviewAts.map(date => date.toISOString())
    };
  }

  /** Rehydrate UTC ISO strings before passing a state back into the scheduler. */
  function deserializeMemoryState(value) {
    if (!value || typeof value !== 'object') throw new TypeError('Serialized memory state must be an object.');
    const state = {
      ...value,
      firstLearnedAt: new Date(value.firstLearnedAt),
      lastReviewedAt: new Date(value.lastReviewedAt),
      nextReviewAt: value.nextReviewAt === null ? null : new Date(value.nextReviewAt),
      shortDeadlineReviewAts: Array.isArray(value.shortDeadlineReviewAts)
        ? value.shortDeadlineReviewAts.map(date => new Date(date))
        : []
    };
    validateMemoryState(state);
    return state;
  }

  return Object.freeze({
    config,
    calculateRetention,
    calculateIntervalMinutes,
    calculateInitialReviewSchedule,
    createInitialMemoryState,
    scheduleNextReview,
    serializeMemoryState,
    deserializeMemoryState
  });
});
