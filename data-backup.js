(function attachLookWordBackup(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LookWordBackup = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createLookWordBackupApi() {
  'use strict';

  const BACKUP_KIND = 'lookword-user-data';
  const BACKUP_VERSION = 1;

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function stringList(value) {
    return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item) : [];
  }

  function mergeUniqueStrings(current, incoming) {
    return [...new Set([...stringList(current), ...stringList(incoming)])];
  }

  function numberOrZero(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function mergeScores(current = {}, incoming = {}) {
    const merged = {};
    for (const key of new Set([...Object.keys(isObject(current) ? current : {}), ...Object.keys(isObject(incoming) ? incoming : {})])) {
      merged[key] = Math.max(numberOrZero(current[key]), numberOrZero(incoming[key]));
    }
    return merged;
  }

  function mergePlans(current = {}, incoming = {}) {
    const merged = {};
    const currentPlans = isObject(current) ? current : {};
    const incomingPlans = isObject(incoming) ? incoming : {};
    for (const date of new Set([...Object.keys(currentPlans), ...Object.keys(incomingPlans)])) {
      const first = isObject(currentPlans[date]) ? currentPlans[date] : {};
      const second = isObject(incomingPlans[date]) ? incomingPlans[date] : {};
      const wordKeys = mergeUniqueStrings(first.wordKeys, second.wordKeys);
      const learnedKeys = mergeUniqueStrings(first.learnedKeys, second.learnedKeys).filter(key => wordKeys.includes(key));
      const createdAt = [first.createdAt, second.createdAt].filter(Boolean).sort()[0];
      merged[date] = {
        ...second,
        ...first,
        wordKeys,
        learnedKeys,
        target: Math.max(numberOrZero(first.target), numberOrZero(second.target), wordKeys.length),
        additions: Math.max(numberOrZero(first.additions), numberOrZero(second.additions)),
        ...(createdAt ? {createdAt} : {})
      };
    }
    return merged;
  }

  function mergeReviewPreferences(current = {}, incoming = {}) {
    const first = isObject(current) ? current : {};
    const second = isObject(incoming) ? incoming : {};
    const merged = {};
    for (const key of new Set([...Object.keys(first), ...Object.keys(second)])) {
      const currentValue = first[key];
      const incomingValue = second[key];
      merged[key] = currentValue === 'review' || incomingValue === 'review'
        ? 'review'
        : currentValue || incomingValue;
    }
    return merged;
  }

  function mergeSession(current = {}, incoming = {}) {
    const first = isObject(current) ? current : {};
    const second = isObject(incoming) ? incoming : {};
    return {
      ...second,
      ...first,
      scores: mergeScores(first.scores, second.scores),
      wrong: mergeUniqueStrings(first.wrong, second.wrong),
      learned: mergeUniqueStrings(first.learned, second.learned),
      dailyPlans: mergePlans(first.dailyPlans, second.dailyPlans),
      reviewPreferences: mergeReviewPreferences(first.reviewPreferences, second.reviewPreferences)
    };
  }

  function normalizeWordbook(record) {
    if (!isObject(record)) throw new Error('备份中的自定义词库格式不正确');
    const id = String(record.id || '');
    const name = String(record.name || '').trim();
    const words = Array.isArray(record.words) ? record.words : [];
    if (!id.startsWith('upload:') || !name || !words.length) {
      throw new Error('备份中的自定义词库缺少必要数据');
    }
    return {
      id,
      name,
      fileName: String(record.fileName || `${name}.json`),
      words: cloneJson(words),
      updatedAt: Number(record.updatedAt) || Date.now()
    };
  }

  function createBackupPayload({state, wordbooks = [], exportedAt = new Date().toISOString()}) {
    if (!isObject(state) || !isObject(state.bookSessions)) {
      throw new Error('当前学习数据无法导出');
    }
    return {
      kind: BACKUP_KIND,
      version: BACKUP_VERSION,
      app: 'LookWord',
      exportedAt,
      state: cloneJson(state),
      uploadedWordbooks: wordbooks.map(normalizeWordbook)
    };
  }

  function parseBackupPayload(input) {
    let payload;
    try {
      payload = typeof input === 'string' ? JSON.parse(input) : cloneJson(input);
    } catch (error) {
      throw new Error('备份文件不是有效的 JSON');
    }
    if (!isObject(payload) || payload.kind !== BACKUP_KIND) {
      throw new Error('这不是 LookWord 数据备份');
    }
    if (Number(payload.version) !== BACKUP_VERSION) {
      throw new Error(`暂不支持该备份版本（${payload.version ?? '未知'}）`);
    }
    if (!isObject(payload.state) || !isObject(payload.state.bookSessions)) {
      throw new Error('备份中缺少学习进度');
    }
    const uploadedWordbooks = Array.isArray(payload.uploadedWordbooks)
      ? payload.uploadedWordbooks.map(normalizeWordbook)
      : [];
    return {
      ...payload,
      state: cloneJson(payload.state),
      uploadedWordbooks
    };
  }

  function mergeBackupState(currentState, incomingState) {
    if (!isObject(currentState) || !isObject(currentState.bookSessions)) {
      throw new Error('当前学习数据无法合并');
    }
    if (!isObject(incomingState) || !isObject(incomingState.bookSessions)) {
      throw new Error('备份中缺少学习进度');
    }
    const currentSessions = currentState.bookSessions;
    const incomingSessions = incomingState.bookSessions;
    const bookSessions = {};
    for (const bookId of new Set([...Object.keys(currentSessions), ...Object.keys(incomingSessions)])) {
      bookSessions[bookId] = mergeSession(currentSessions[bookId], incomingSessions[bookId]);
    }
    return {
      ...cloneJson(incomingState),
      ...cloneJson(currentState),
      bookSessions
    };
  }

  return {BACKUP_KIND, BACKUP_VERSION, createBackupPayload, parseBackupPayload, mergeBackupState};
});
