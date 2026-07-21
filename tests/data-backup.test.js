'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {createBackupPayload, parseBackupPayload, mergeBackupState} = require('../data-backup.js');

function sampleState() {
  return {
    activeBookId: 'builtin:sat-yu-minhong',
    bookSessions: {'builtin:sat-yu-minhong': {scores: {lucid: 3}, wrong: []}}
  };
}

test('creates a portable backup with progress and uploaded wordbooks', () => {
  const state = sampleState();
  const wordbooks = [{id: 'upload:mine', name: '我的词库', words: [{word: 'lucid'}]}];
  const payload = createBackupPayload({state, wordbooks, exportedAt: '2026-07-20T12:00:00.000Z'});

  assert.equal(payload.kind, 'lookword-user-data');
  assert.equal(payload.version, 1);
  assert.equal(payload.uploadedWordbooks.length, 1);
  assert.equal(payload.state.bookSessions['builtin:sat-yu-minhong'].scores.lucid, 3);

  state.bookSessions['builtin:sat-yu-minhong'].scores.lucid = 0;
  wordbooks[0].words[0].word = 'changed';
  assert.equal(payload.state.bookSessions['builtin:sat-yu-minhong'].scores.lucid, 3);
  assert.equal(payload.uploadedWordbooks[0].words[0].word, 'lucid');
});

test('parses a valid JSON backup', () => {
  const source = createBackupPayload({state: sampleState()});
  const restored = parseBackupPayload(JSON.stringify(source));
  assert.equal(restored.app, 'LookWord');
  assert.deepEqual(restored.uploadedWordbooks, []);
});

test('rejects unrelated or incomplete JSON files', () => {
  assert.throws(() => parseBackupPayload('{"words":[]}'), /不是 LookWord/);
  assert.throws(
    () => parseBackupPayload(JSON.stringify({kind: 'lookword-user-data', version: 1, state: {}})),
    /缺少学习进度/
  );
});

test('rejects unsupported versions and malformed uploaded books', () => {
  assert.throws(
    () => parseBackupPayload({kind: 'lookword-user-data', version: 2, state: sampleState()}),
    /不支持/
  );
  assert.throws(
    () => parseBackupPayload({
      kind: 'lookword-user-data',
      version: 1,
      state: sampleState(),
      uploadedWordbooks: [{id: 'builtin:bad', name: 'bad', words: [{word: 'bad'}]}]
    }),
    /缺少必要数据/
  );
});

test('merges progress without dropping current or backed-up study records', () => {
  const current = {
    dailyGoal: 12,
    activeBookId: 'builtin:current',
    bookSessions: {
      'builtin:current': {
        scores: {lucid: 3, tenuous: 1},
        wrong: ['tenuous'],
        learned: ['lucid'],
        dailyPlans: {
          '2026-07-20': {wordKeys:['lucid'], learnedKeys:['lucid'], target:1, additions:0, createdAt:'2026-07-20T10:00:00Z'}
        },
        reviewPreferences: {lucid:'mastered', tenuous:'review'},
        current: 4,
        order: ['lucid'],
        orderScope: 'today'
      }
    }
  };
  const incoming = {
    dailyGoal: 7,
    activeBookId: 'upload:backup',
    bookSessions: {
      'builtin:current': {
        scores: {lucid: 1, arduous: 2},
        wrong: ['arduous'],
        learned: ['arduous'],
        dailyPlans: {
          '2026-07-20': {wordKeys:['arduous'], learnedKeys:['arduous'], target:1, additions:1, createdAt:'2026-07-20T09:00:00Z'}
        },
        reviewPreferences: {lucid:'review', arduous:'mastered'},
        current: 0,
        order: [],
        orderScope: 'wrong'
      },
      'upload:backup': {scores:{resilient:2}, wrong:[], learned:['resilient'], dailyPlans:{}, reviewPreferences:{}}
    }
  };

  const merged = mergeBackupState(current, incoming);
  const session = merged.bookSessions['builtin:current'];

  assert.deepEqual(session.scores, {lucid:3, tenuous:1, arduous:2});
  assert.deepEqual(session.wrong, ['tenuous', 'arduous']);
  assert.deepEqual(session.learned, ['lucid', 'arduous']);
  assert.deepEqual(session.dailyPlans['2026-07-20'].wordKeys, ['lucid', 'arduous']);
  assert.deepEqual(session.dailyPlans['2026-07-20'].learnedKeys, ['lucid', 'arduous']);
  assert.equal(session.dailyPlans['2026-07-20'].createdAt, '2026-07-20T09:00:00Z');
  assert.equal(session.reviewPreferences.lucid, 'review');
  assert.equal(session.current, 4);
  assert.equal(session.orderScope, 'today');
  assert.equal(merged.dailyGoal, 12);
  assert.equal(merged.bookSessions['upload:backup'].scores.resilient, 2);
});
