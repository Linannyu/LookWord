'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const scheduler = require('../review-scheduler.js');

const MINUTE = 60_000;
const BASE = new Date('2026-01-01T00:00:00.000Z');
const FAR_DEADLINE = new Date('2027-01-01T00:00:00.000Z');
const plusMinutes = (date, minutes) => new Date(date.getTime() + minutes * MINUTE);
const initialState = (deadline = FAR_DEADLINE) => scheduler.createInitialMemoryState('arduous', BASE, deadline);
const schedule = (result, state = initialState(), reviewedAt = plusMinutes(BASE, 10), deadline = FAR_DEADLINE) =>
  scheduler.scheduleNextReview({currentState: state, result, reviewedAt, deadline});

test('1. retention decreases as elapsed time increases', () => {
  assert.ok(scheduler.calculateRetention(30, 60) > scheduler.calculateRetention(120, 60));
});

test('2. higher stability slows forgetting', () => {
  assert.ok(scheduler.calculateRetention(120, 240) > scheduler.calculateRetention(120, 60));
});

test('3. higher target retention produces a shorter interval', () => {
  assert.ok(scheduler.calculateIntervalMinutes(600, 0.90) < scheduler.calculateIntervalMinutes(600, 0.80));
});

test('4. a new word is first scheduled exactly ten minutes later', () => {
  const state = initialState();
  assert.equal(state.nextReviewAt.toISOString(), '2026-01-01T00:10:00.000Z');
  assert.equal(state.stabilityMinutes, 60);
  assert.equal(state.stage, 0);
});

test('5. forgot reduces stability but not below the configured minimum', () => {
  const output = schedule('forgot');
  assert.equal(output.updatedState.stabilityMinutes, 21);
  const floorState = {...initialState(), stabilityMinutes: 10};
  assert.equal(schedule('forgot', floorState).updatedState.stabilityMinutes, 10);
});

test('6. forgot schedules a ten-minute rescue review', () => {
  const output = schedule('forgot');
  assert.equal(output.finalIntervalMinutes, 10);
  assert.equal(output.updatedState.nextReviewAt.toISOString(), '2026-01-01T00:20:00.000Z');
});

test('7. hard interval is shorter than good', () => {
  assert.ok(schedule('hard').normalIntervalMinutes < schedule('good').normalIntervalMinutes);
});

test('8. good interval is shorter than easy', () => {
  assert.ok(schedule('good').normalIntervalMinutes < schedule('easy').normalIntervalMinutes);
});

test('9. consecutive correct reviews progressively increase stability and streak', () => {
  const first = schedule('good');
  const secondAt = first.updatedState.nextReviewAt;
  const second = schedule('good', first.updatedState, secondAt);
  assert.ok(second.updatedState.stabilityMinutes > first.updatedState.stabilityMinutes);
  assert.equal(second.updatedState.correctStreak, 2);
});

test('10. an interval beyond the deadline is compressed to 75% of the remaining time', () => {
  const state = {...initialState(), stabilityMinutes: 100_000, shortDeadlineReviewAts: []};
  const reviewedAt = plusMinutes(BASE, 10);
  const deadline = plusMinutes(reviewedAt, 100);
  const output = schedule('good', state, reviewedAt, deadline);
  assert.equal(output.finalIntervalMinutes, 75);
  assert.equal(output.wasCompressedByDeadline, true);
});

test('11. a shorter deadline creates a shorter final interval', () => {
  const state = {...initialState(), stabilityMinutes: 100_000, shortDeadlineReviewAts: []};
  const reviewedAt = plusMinutes(BASE, 10);
  const short = schedule('good', state, reviewedAt, plusMinutes(reviewedAt, 100));
  const long = schedule('good', state, reviewedAt, plusMinutes(reviewedAt, 200));
  assert.ok(short.finalIntervalMinutes < long.finalIntervalMinutes);
});

test('12. no review is scheduled when ten minutes or less remain', () => {
  const reviewedAt = plusMinutes(BASE, 10);
  const output = schedule('good', initialState(), reviewedAt, plusMinutes(reviewedAt, 10));
  assert.equal(output.finalIntervalMinutes, null);
  assert.equal(output.updatedState.nextReviewAt, null);
});

test('13. generated review dates never exceed the deadline', () => {
  const reviewedAt = plusMinutes(BASE, 10);
  for (const result of scheduler.config.REVIEW_RESULTS) {
    const deadline = plusMinutes(reviewedAt, 17);
    const output = schedule(result, initialState(), reviewedAt, deadline);
    if (output.updatedState.nextReviewAt) {
      assert.ok(output.updatedState.nextReviewAt.getTime() <= deadline.getTime());
      assert.ok(output.updatedState.nextReviewAt.getTime() > reviewedAt.getTime());
    }
  }
});

test('14. invalid inputs return explicit errors', () => {
  assert.throws(() => scheduler.calculateRetention(-1, 60), /elapsedMinutes/);
  assert.throws(() => scheduler.calculateIntervalMinutes(60, 1), /targetRetention/);
  assert.throws(() => scheduler.createInitialMemoryState('', BASE, FAR_DEADLINE), /wordId/);
  assert.throws(() => scheduler.createInitialMemoryState('arduous', BASE, plusMinutes(BASE, -1)), /deadline/);
  assert.throws(() => schedule('unknown'), /result must be one of/);
  assert.throws(() => schedule('good', initialState(), new Date('invalid')), /valid Date/);
});

test('15. all numeric calculation results are finite', () => {
  for (const stability of [0.1, 10, 60, 10_000, Number.MAX_SAFE_INTEGER]) {
    const retention = scheduler.calculateRetention(1_000, stability);
    const interval = scheduler.calculateIntervalMinutes(stability, 0.85);
    assert.equal(Number.isFinite(retention), true);
    assert.equal(Number.isFinite(interval), true);
  }
});

test('16. fixed inputs produce deterministic repeatable output', () => {
  const input = {currentState: initialState(), result: 'good', reviewedAt: plusMinutes(BASE, 10), deadline: FAR_DEADLINE};
  const first = scheduler.scheduleNextReview(input);
  const second = scheduler.scheduleNextReview(input);
  assert.deepEqual(scheduler.serializeMemoryState(first.updatedState), scheduler.serializeMemoryState(second.updatedState));
  assert.deepEqual({...first, updatedState:null}, {...second, updatedState:null});
});

test('17. short deadlines create deduplicated checkpoints with minimum gaps', () => {
  const deadline = plusMinutes(BASE, 12 * 60);
  const scheduleDates = scheduler.calculateInitialReviewSchedule(BASE, deadline);
  assert.deepEqual(scheduleDates.map(date => date.toISOString()), [
    '2026-01-01T00:10:00.000Z',
    '2026-01-01T06:00:00.000Z',
    '2026-01-01T10:12:00.000Z'
  ]);
  const offsets = scheduleDates.map(date => (date - BASE) / MINUTE);
  assert.equal(new Set(offsets).size, offsets.length);
  assert.ok(offsets.every((offset, index) => index === 0 || offset - offsets[index - 1] >= 10));
});

test('18. short-deadline checkpoints protect against a single late review', () => {
  const deadline = plusMinutes(BASE, 12 * 60);
  const state = scheduler.createInitialMemoryState('arduous', BASE, deadline);
  const output = schedule('easy', state, plusMinutes(BASE, 10), deadline);
  assert.ok(output.updatedState.shortDeadlineReviewAts.length >= 2);
  assert.ok(output.updatedState.nextReviewAt.getTime() <= deadline.getTime());
  assert.equal(output.updatedState.shortDeadlineReviewAts.some(date => date.getTime() === output.updatedState.nextReviewAt.getTime()), false);
});

test('19. review counters, streaks and lapses update correctly', () => {
  const success = schedule('good');
  const lapse = schedule('forgot', success.updatedState, success.updatedState.nextReviewAt);
  assert.equal(lapse.updatedState.reviewCount, 2);
  assert.equal(lapse.updatedState.correctStreak, 0);
  assert.equal(lapse.updatedState.lapseCount, 1);
  assert.equal(lapse.updatedState.lastResult, 'forgot');
});

test('20. UTC serialization round-trips without changing dates', () => {
  const state = initialState(plusMinutes(BASE, 12 * 60));
  const serialized = scheduler.serializeMemoryState(state);
  assert.match(serialized.firstLearnedAt, /Z$/);
  assert.match(serialized.nextReviewAt, /Z$/);
  assert.deepEqual(scheduler.serializeMemoryState(scheduler.deserializeMemoryState(serialized)), serialized);
});

test('21. scheduling does not mutate the input state', () => {
  const state = initialState();
  const before = scheduler.serializeMemoryState(state);
  schedule('easy', state);
  assert.deepEqual(scheduler.serializeMemoryState(state), before);
});

test('22. classic browser scripts expose the scheduler without a bundler', () => {
  const browserContext = {};
  browserContext.globalThis = browserContext;
  vm.createContext(browserContext);
  for (const filename of ['review-scheduler-config.js', 'review-scheduler.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
    vm.runInContext(source, browserContext, {filename});
  }
  assert.equal(typeof browserContext.ReviewScheduler.calculateRetention, 'function');
  assert.equal(browserContext.ReviewScheduler.calculateRetention(0, 60), 1);
});
