/**
 * Local score/flow pack merge and MRJ_AUTH progress helpers (pure, testable).
 */

export const PACK_PROGRAM = 'pronounce-whistle';
export const SCORE_PROGRAM = 'pronounce';
export const WHISTLE_ITEM_PREFIX = 'whistle:';
export const REMOTE_SAVE_MS = 17000;

export function studentStorageSuffix(studentId) {
  return String(studentId == null ? '' : studentId)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function resolveStudentId(auth) {
  if (!auth || typeof auth.student !== 'function') return '';
  const raw = auth.student();
  if (raw == null) return '';
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'object' && raw.id != null) return String(raw.id).trim();
  return '';
}

export function storageKeyForStudent(baseKey, studentSuffix) {
  const suffix = studentStorageSuffix(studentSuffix);
  if (!suffix) return baseKey;
  return `${baseKey}::${suffix}`;
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function whole(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function parseProgressScore(text) {
  const s = String(text == null ? '' : text).trim();
  if (!s) return null;
  const slash = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (slash) {
    const max = Number(slash[2]);
    if (max > 0) return Math.round((Number(slash[1]) / max) * 100);
  }
  const pct = s.match(/(\d+(?:\.\d+)?)\s*%?/);
  if (pct) return Math.round(Number(pct[1]));
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function minimalScoreFromPct(scorePct) {
  const pct = whole(scorePct);
  return {
    score: pct / 100,
    scorePct: pct,
    orderPct: pct,
    samePct: pct,
    pass: pct >= 70,
    weak: [],
    reason: '',
    english: '',
    words: [],
    heard: '',
    at: 0,
  };
}

export function mergeScoreRecord(a, b) {
  const left = plainObject(a);
  const right = plainObject(b);
  if (!Object.keys(left).length) return { ...right };
  if (!Object.keys(right).length) return { ...left };
  const leftPct = whole(left.scorePct != null ? left.scorePct : left.score * 100);
  const rightPct = whole(right.scorePct != null ? right.scorePct : right.score * 100);
  const pickRight = rightPct > leftPct;
  const base = pickRight ? { ...left, ...right } : { ...right, ...left };
  const bestPct = Math.max(leftPct, rightPct);
  const leftAt = whole(left.at);
  const rightAt = whole(right.at);
  const at = leftAt && rightAt ? Math.min(leftAt, rightAt) : (leftAt || rightAt);
  return Object.assign({}, base, {
    scorePct: bestPct,
    score: bestPct / 100,
    pass: !!(left.pass || right.pass || bestPct >= 70),
    at,
  });
}

export function mergeScoreMaps(a, b) {
  const out = { ...plainObject(a) };
  const other = plainObject(b);
  for (const key of Object.keys(other)) {
    out[key] = out[key] ? mergeScoreRecord(out[key], other[key]) : { ...other[key] };
  }
  return out;
}

const PHASE_RANK = { part1: 1, teacher: 2, part2: 3, results: 4 };

function phaseRank(phase) {
  return PHASE_RANK[phase] || 1;
}

function mergeFails(a, b) {
  const out = { ...plainObject(a) };
  const other = plainObject(b);
  for (const key of Object.keys(other)) {
    out[key] = Math.max(whole(out[key]), whole(other[key]));
  }
  return out;
}

function mergeBoolMap(a, b) {
  const out = { ...plainObject(a) };
  const other = plainObject(b);
  for (const key of Object.keys(other)) {
    out[key] = !!(out[key] || other[key]);
  }
  return out;
}

function mergePart2(a, b) {
  const left = plainObject(a);
  const right = plainObject(b);
  const pick = whole(left.startedAt) >= whole(right.startedAt) ? left : right;
  const other = pick === left ? right : left;
  return {
    wordCount: Math.max(whole(left.wordCount), whole(right.wordCount)),
    limitSec: pick.limitSec === 90 || other.limitSec === 90 ? 90 : 60,
    startedAt: Math.max(whole(left.startedAt), whole(right.startedAt)),
    stoppedAt: Math.max(whole(left.stoppedAt), whole(right.stoppedAt)),
    secondsUsed: pick.secondsUsed != null ? pick.secondsUsed : other.secondsUsed,
  };
}

export function mergeFlowState(a, b) {
  const left = plainObject(a);
  const right = plainObject(b);
  if (!Object.keys(left).length) return { ...right };
  if (!Object.keys(right).length) return { ...left };
  const phase = phaseRank(left.phase) >= phaseRank(right.phase) ? left.phase : right.phase;
  return {
    phase,
    fails: mergeFails(left.fails, right.fails),
    student: mergeScoreMaps(left.student, right.student),
    attempts: mergeScoreMaps(left.attempts, right.attempts),
    teacher: mergeBoolMap(left.teacher, right.teacher),
    rushRecorded: mergeBoolMap(left.rushRecorded, right.rushRecorded),
    rushGrades: mergeScoreMaps(left.rushGrades, right.rushGrades),
    part2: mergePart2(left.part2, right.part2),
  };
}

export function mergeFlowBooks(a, b) {
  const out = { ...plainObject(a) };
  const other = plainObject(b);
  for (const key of Object.keys(other)) {
    out[key] = out[key] ? mergeFlowState(out[key], other[key]) : { ...other[key] };
  }
  return out;
}

export function parseProgressPack(jsonText) {
  if (jsonText == null || String(jsonText).trim() === '') {
    return { scores: {}, flows: {}, unparseable: false };
  }
  try {
    const data = JSON.parse(String(jsonText));
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { scores: {}, flows: {}, unparseable: true };
    }
    if (data.scores != null || data.flows != null) {
      return {
        scores: plainObject(data.scores),
        flows: plainObject(data.flows),
        unparseable: false,
      };
    }
    return { scores: plainObject(data), flows: {}, unparseable: false };
  } catch (_) {
    return { scores: {}, flows: {}, unparseable: true };
  }
}

export function serializeProgressPack(scores, flows) {
  return JSON.stringify({
    v: 1,
    scores: plainObject(scores),
    flows: plainObject(flows),
  });
}

export function mergePackContents(localScores, localFlows, remoteScores, remoteFlows) {
  return {
    scores: mergeScoreMaps(localScores, remoteScores),
    flows: mergeFlowBooks(localFlows, remoteFlows),
  };
}

export function scoresFromProgressRows(rows, program = SCORE_PROGRAM, prefix = WHISTLE_ITEM_PREFIX) {
  const out = {};
  for (const row of rows || []) {
    if (!row || String(row.program || '') !== program) continue;
    const item = String(row.item || '');
    if (!item.startsWith(prefix)) continue;
    const key = item.slice(prefix.length);
    if (!key) continue;
    const scorePct = parseProgressScore(row.score);
    if (scorePct == null) continue;
    const rec = minimalScoreFromPct(scorePct);
    out[key] = out[key] ? mergeScoreRecord(out[key], rec) : rec;
  }
  return out;
}

export function readJsonStorage(storage, key) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

/** Per-student keys only — never read or copy the device-wide legacy key (shared lab PCs). */
export function readStudentStorage(storage, studentKey) {
  return readJsonStorage(storage, studentKey);
}

export function packSaveAllowed(state) {
  return !!(state && state.packLoadOk && state.packLoaded && !state.packLoadFailed);
}

export function createPackSync(deps) {
  const state = {
    studentSuffix: '',
    packLoaded: false,
    packLoadOk: false,
    packLoadFailed: false,
    dirty: false,
    lastSaveAt: 0,
    timer: null,
  };

  function auth() {
    return deps.getAuth();
  }

  function readLocal() {
    return {
      scores: readStudentStorage(deps.storage, deps.scoreStorageKey()),
      flows: readStudentStorage(deps.storage, deps.flowStorageKey()),
    };
  }

  function writeLocal(scores, flows) {
    try {
      deps.storage.setItem(deps.scoreStorageKey(), JSON.stringify(plainObject(scores)));
      deps.storage.setItem(deps.flowStorageKey(), JSON.stringify(plainObject(flows)));
    } catch (_) {}
  }

  function markDirty() {
    state.dirty = true;
    scheduleSave();
  }

  function scheduleSave() {
    if (state.timer) return;
    const wait = Math.max(0, REMOTE_SAVE_MS - (Date.now() - state.lastSaveAt));
    state.timer = setTimeout(() => {
      state.timer = null;
      void flushSave(false);
    }, wait);
  }

  async function flushSave(force) {
    if (!state.dirty && !force) return;
    if (!packSaveAllowed(state)) return;
    const a = auth();
    if (!a || typeof a.savePack !== 'function' || typeof a.packReady !== 'function') return;
    if (!a.packReady(PACK_PROGRAM)) return;
    const { scores, flows } = readLocal();
    const body = serializeProgressPack(scores, flows);
    state.dirty = false;
    const result = await a.savePack(PACK_PROGRAM, body);
    if (result && result.ok) {
      state.lastSaveAt = Date.now();
    } else {
      state.dirty = true;
      state.packLoadFailed = true;
      state.packLoadOk = false;
    }
  }

  async function loadProgressRows(a, detail) {
    if (typeof a.loadProgressForApp === 'function') {
      const result = await a.loadProgressForApp(SCORE_PROGRAM);
      if (result && result.ok && Array.isArray(result.progress)) return result.progress;
    }
    if (detail && Array.isArray(detail.progress)) return detail.progress;
    return [];
  }

  async function onAuthReady(detail) {
    const a = auth();
    const studentId = resolveStudentId(a);
    const suffix = studentStorageSuffix(studentId);
    state.studentSuffix = suffix;
    deps.setActiveStudent(suffix);
    if (!suffix) return;

    let { scores, flows } = readLocal();

    const progressErr = a && typeof a.progressError === 'function' ? String(a.progressError() || '') : '';
    const progressRows = progressErr
      ? []
      : await loadProgressRows(a, detail);
    const seeded = scoresFromProgressRows(progressRows);
    if (Object.keys(seeded).length) {
      scores = mergeScoreMaps(scores, seeded);
      writeLocal(scores, flows);
    }

    if (!a || typeof a.loadPack !== 'function') {
      if (typeof deps.onSynced === 'function') deps.onSynced();
      return;
    }

    state.packLoaded = false;
    state.packLoadOk = false;
    state.packLoadFailed = false;

    const packResult = await a.loadPack(PACK_PROGRAM);
    if (!packResult || !packResult.ok) {
      state.packLoadFailed = true;
      if (typeof deps.onSynced === 'function') deps.onSynced();
      return;
    }

    state.packLoaded = true;
    state.packLoadOk = true;
    const parsed = parseProgressPack(packResult.progress_json);
    const remoteScores = parsed.unparseable ? {} : parsed.scores;
    const remoteFlows = parsed.unparseable ? {} : parsed.flows;
    const merged = mergePackContents(scores, flows, remoteScores, remoteFlows);
    writeLocal(merged.scores, merged.flows);
    const remoteBody = serializeProgressPack(remoteScores, remoteFlows);
    const mergedBody = serializeProgressPack(merged.scores, merged.flows);
    state.dirty = mergedBody !== remoteBody;
    if (state.dirty) scheduleSave();
    if (typeof deps.onSynced === 'function') deps.onSynced();
  }

  function onSignOut() {
    state.studentSuffix = '';
    state.packLoaded = false;
    state.packLoadOk = false;
    state.packLoadFailed = false;
    state.dirty = false;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    deps.setActiveStudent('');
  }

  function installFlushHooks() {
    const flush = () => { void flushSave(true); };
    if (typeof deps.window.addEventListener === 'function') {
      deps.window.addEventListener('pagehide', flush);
      deps.window.addEventListener('visibilitychange', () => {
        if (deps.document.visibilityState === 'hidden') flush();
      });
    }
  }

  return {
    state,
    onAuthReady,
    onSignOut,
    markDirty,
    flushSave,
    installFlushHooks,
  };
}
