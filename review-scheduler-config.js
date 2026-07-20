(function attachReviewSchedulerConfig(root, factory) {
  const config = factory();
  if (typeof module === 'object' && module.exports) module.exports = config;
  if (root) root.ReviewSchedulerConfig = config;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createReviewSchedulerConfig() {
  'use strict';

  const config = {
    MILLISECONDS_PER_MINUTE: 60_000,
    DEFAULT_TARGET_RETENTION: 0.85,
    INITIAL_STABILITY_MINUTES: 60,
    MIN_STABILITY_MINUTES: 10,
    FIRST_REVIEW_DELAY_MINUTES: 10,
    MIN_REVIEW_GAP_MINUTES: 10,
    DEADLINE_REVIEW_RATIO: 0.75,
    SHORT_DEADLINE_THRESHOLD_MINUTES: 24 * 60,
    SHORT_DEADLINE_REVIEW_RATIOS: Object.freeze([0.5, 0.85]),
    STABILITY_FACTORS: Object.freeze({
      forgot: 0.35,
      hard: 1.2,
      good: 1.8,
      easy: 2.5
    }),
    TARGET_RETENTION_BY_RESULT: Object.freeze({
      hard: 0.90,
      good: 0.85,
      easy: 0.80
    }),
    REVIEW_RESULTS: Object.freeze(['forgot', 'hard', 'good', 'easy'])
  };

  return Object.freeze(config);
});
