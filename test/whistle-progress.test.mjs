import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PACK_PROGRAM,
  SCORE_PROGRAM,
  WHISTLE_ITEM_PREFIX,
  createPackSync,
  mergeScoreMaps,
  mergeScoreRecord,
  packSaveAllowed,
  parseProgressPack,
  parseProgressScore,
  resolveStudentId,
  scoresFromProgressRows,
  serializeProgressPack,
  storageKeyForStudent,
} from '../src/whistle-progress.js';

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
    legacyScoreKey: 'legacy-scores',
    legacyFlowKey: 'legacy-flows',
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
    scoreStorageKey: () => storageKeyForStudent('legacy-scores', 'TestKid'),
    flowStorageKey: () => storageKeyForStudent('legacy-flows', 'TestKid'),
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
