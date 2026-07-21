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

  return {BACKUP_KIND, BACKUP_VERSION, createBackupPayload, parseBackupPayload};
});
