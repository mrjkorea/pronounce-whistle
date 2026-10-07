import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PACK_PROGRAM,
  SCORE_PROGRAM,
  WHISTLE_ITEM_PREFIX,
  createPackSync,
  loadPackWithRetry,
  mergeScoreMaps,
  mergeScoreRecord,
  packSaveAllowed,
  parseProgressPack,
  parseProgressScore,
  resolveStudentId,
  scoresFromProgressRows,
  readJsonStorage,
  serializeProgressPack,
  storageKeyForStudent,
} from '../src/whistle-progress.js';

const LEGACY_SCORE_KEY = 'day4-pronounce-scores-v2';
const LEGACY_FLOW_KEY = 'day4-pronounce-two-parts-v1';

test('resolveStudentId accepts string or object student()', () => {
  assert.equal(resolveStudentId({ student: () => 'Jay' }), 'Jay');
  assert.equal(resolveStudentId({ student: () => ({ id: 'Sam' }) }), 'Sam');
  assert.equal(resolveStudentId({ student: () => '' }), '');
});

test('mergeScoreRecord keeps the best score and earliest timestamp', () => {
  const merged = mergeScoreRecord(
    { scorePct: 60, pass: false, at: 100 },
    { scorePct: 85, pass: true, at: 200 },
  );
  assert.equal(merged.scorePct, 85);
  assert.equal(merged.pass, true);
  assert.equal(merged.at, 100);
});

test('mergeScoreMaps does not let empty remote wipe local data', () => {
  const local = { a: { scorePct: 90, pass: true, at: 1 } };
  assert.deepEqual(mergeScoreMaps(local, {}), local);
});

test('parseProgressPack treats bad server JSON as empty-but-loaded', () => {
  const parsed = parseProgressPack('{not json');
  assert.equal(parsed.unparseable, true);
  assert.deepEqual(parsed.scores, {});
});

test('scoresFromProgressRows filters pronounce whistle items', () => {
  const rows = [
    { program: 'other', item: 'whistle:x', score: '80%' },
    { program: SCORE_PROGRAM, item: 'pronounce:x', score: '90%' },
    { program: SCORE_PROGRAM, item: `${WHISTLE_ITEM_PREFIX}line-1`, score: '72/100' },
  ];
  const scores = scoresFromProgressRows(rows);
  assert.equal(Object.keys(scores).length, 1);
  assert.equal(scores['line-1'].scorePct, 72);
});

test('pack save is gated until loadPack succeeds', () => {
  assert.equal(packSaveAllowed({ packLoaded: true, packLoadOk: true, packLoadFailed: false }), true);
  assert.equal(packSaveAllowed({ packLoaded: false, packLoadOk: false, packLoadFailed: true }), false);
});

test('device-wide legacy localStorage is never merged or sent in savePack', async () => {
  const legacyScores = { 'other-student-line': { scorePct: 99, pass: true, at: 1 } };
  const legacyFlows = { 'basic_a/unit1': { phase: 'part2', fails: {}, student: {}, attempts: {} } };
  const saves = [];
  const storage = {
    data: {
      [LEGACY_SCORE_KEY]: JSON.stringify(legacyScores),
      [LEGACY_FLOW_KEY]: JSON.stringify(legacyFlows),
    },
    getItem(key) { return this.data[key] || null; },
    setItem(key, value) { this.data[key] = value; },
  };
  const sync = createPackSync({
    storage,
    window: { addEventListener() {} },
    document: { visibilityState: 'visible' },
    getAuth: () => ({
      student: () => 'Alice',
      progressError: () => '',
      loadProgressForApp: async () => ({ ok: true, progress: [] }),
      loadPack: async () => ({ ok: true, found: false, progress_json: '{}' }),
      savePack: async (program, json) => {
        saves.push({ program, json });
        return { ok: true };
      },
      packReady: (program) => program === PACK_PROGRAM,
    }),
    setActiveStudent() {},
    scoreStorageKey: () => storageKeyForStudent(LEGACY_SCORE_KEY, 'Alice'),
    flowStorageKey: () => storageKeyForStudent(LEGACY_FLOW_KEY, 'Alice'),
  });

  await sync.onAuthReady({ progress: [] });
  assert.deepEqual(readJsonStorage(storage, LEGACY_SCORE_KEY), legacyScores);
  assert.deepEqual(readJsonStorage(storage, LEGACY_FLOW_KEY), legacyFlows);
  sync.markDirty();
  await sync.flushSave(true);
  assert.equal(saves.length, 1);
  const body = JSON.parse(saves[0].json);
  assert.equal(body.scores['other-student-line'], undefined);
  assert.equal(body.flows['basic_a/unit1'], undefined);
});

test('createPackSync refuses savePack before loadPack', async () => {
  const saves = [];
  const storage = {
    data: {},
    getItem(key) { return this.data[key] || null; },
    setItem(key, value) { this.data[key] = value; },
  };
  const sync = createPackSync({
    storage,
    window: { addEventListener() {} },
    document: { visibilityState: 'visible' },
    getAuth: () => ({
      student: () => 'TestKid',
      progressError: () => '',
      loadProgressForApp: async () => ({ ok: true, progress: [] }),
      loadPack: async () => ({ ok: true, found: false, progress_json: '{}' }),
      savePack: async (program, json) => {
        saves.push({ program, json });
        return { ok: true };
      },
      packReady: (program) => program === PACK_PROGRAM,
    }),
    setActiveStudent() {},
    scoreStorageKey: () => storageKeyForStudent(LEGACY_SCORE_KEY, 'TestKid'),
    flowStorageKey: () => storageKeyForStudent(LEGACY_FLOW_KEY, 'TestKid'),
  });

  sync.markDirty();
  await sync.flushSave(true);
  assert.equal(saves.length, 0);

  await sync.onAuthReady({ progress: [] });
  sync.markDirty();
  await sync.flushSave(true);
  assert.equal(saves.length, 1);
  const body = JSON.parse(saves[0].json);
  assert.equal(body.v, 1);
});

test('loadPackWithRetry backs off until load succeeds', async () => {
  let calls = 0;
  const waits = [];
  const auth = {
    loadPack: async () => {
      calls += 1;
      if (calls < 3) return { ok: false, error: 'network' };
      return { ok: true, progress_json: '{}' };
    },
  };
  const result = await loadPackWithRetry(
    auth,
    PACK_PROGRAM,
    [0, 5, 5],
    async (ms) => { waits.push(ms); },
  );
  assert.equal(result.ok, true);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [5, 5]);
});

test('scores and unit flows written during sync survive server pack merge', async () => {
  let resolvePack;
  let resolveProgress;
  const packDeferred = new Promise((resolve) => { resolvePack = resolve; });
  const progressDeferred = new Promise((resolve) => { resolveProgress = resolve; });

  const scoreKey = storageKeyForStudent(LEGACY_SCORE_KEY, 'Bob');
  const flowKey = storageKeyForStudent(LEGACY_FLOW_KEY, 'Bob');
  const storage = {
    data: {},
    getItem(key) { return this.data[key] || null; },
    setItem(key, value) { this.data[key] = value; },
  };

  const remotePack = serializeProgressPack(
    { 'line-1': { scorePct: 50, pass: false, at: 1 } },
    {},
  );
  const inProgressFlow = {
    phase: 'part2',
    fails: {},
    student: {},
    attempts: { 'line-1': { scorePct: 40, pass: false, at: 2 } },
    teacher: {},
    rushRecorded: {},
    rushGrades: {},
    part2: { wordCount: 10, limitSec: 60, startedAt: 999, stoppedAt: 0, secondsUsed: null },
  };

  const sync = createPackSync({
    storage,
    window: { addEventListener() {} },
    document: { visibilityState: 'visible' },
    loadPackRetryDelays: [0],
    getAuth: () => ({
      student: () => 'Bob',
      progressError: () => '',
      loadProgressForApp: () => progressDeferred,
      loadPack: () => packDeferred,
      savePack: async () => ({ ok: true }),
      packReady: (program) => program === PACK_PROGRAM,
    }),
    setActiveStudent() {},
    scoreStorageKey: () => scoreKey,
    flowStorageKey: () => flowKey,
  });

  const done = sync.onAuthReady({ progress: [] });
  await new Promise((resolve) => { setImmediate(resolve); });

  storage.setItem(scoreKey, JSON.stringify({
    'line-1': { scorePct: 88, pass: true, at: 50 },
  }));
  storage.setItem(flowKey, JSON.stringify({
    'basic_a/unit1': inProgressFlow,
  }));

  resolveProgress({ ok: true, progress: [] });
  resolvePack({ ok: true, found: true, progress_json: remotePack });
  await done;

  const scores = readJsonStorage(storage, scoreKey);
  assert.equal(scores['line-1'].scorePct, 88);
  const flows = readJsonStorage(storage, flowKey);
  assert.equal(flows['basic_a/unit1'].phase, 'part2');
  assert.equal(flows['basic_a/unit1'].part2.startedAt, 999);
});

test('flushSave skips when not dirty even if forced (pagehide)', async () => {
  const saves = [];
  const storage = {
    data: {},
    getItem(key) { return this.data[key] || null; },
    setItem(key, value) { this.data[key] = value; },
  };
  const sync = createPackSync({
    storage,
    window: { addEventListener() {} },
    document: { visibilityState: 'visible' },
    getAuth: () => ({
      student: () => 'Pat',
      progressError: () => '',
      loadProgressForApp: async () => ({ ok: true, progress: [] }),
      loadPack: async () => ({ ok: true, found: false, progress_json: '{}' }),
      savePack: async (program, json) => {
        saves.push({ program, json });
        return { ok: true };
      },
      packReady: (program) => program === PACK_PROGRAM,
    }),
    setActiveStudent() {},
    scoreStorageKey: () => storageKeyForStudent(LEGACY_SCORE_KEY, 'Pat'),
    flowStorageKey: () => storageKeyForStudent(LEGACY_FLOW_KEY, 'Pat'),
  });

  await sync.onAuthReady({ progress: [] });
  sync.state.dirty = false;
  await sync.flushSave(true);
  assert.equal(saves.length, 0);
});
