import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {
  SAVE_FIX_BUILD,
  attemptErrorCmPostOpts,
  gradedCmPostOpts,
  noteScoreArgs,
  persistScoredTry,
} from '../src/score-persist.js';

const TEST_STUDENT = 'zz_test_mrjmetrics';

function loadMrjScores(authStudent) {
  const fetches = [];
  const storage = { data: {} };
  const root = {
    MRJ_AUTH: authStudent
      ? { student: () => authStudent }
      : undefined,
    fetch(url, init) {
      fetches.push({ url, init });
      return Promise.resolve({
        ok: true,
        json: async () => ({ status: 'ok' }),
      });
    },
    localStorage: {
      getItem(key) { return storage.data[key] || null; },
      setItem(key, value) { storage.data[key] = value; },
    },
    addEventListener() {},
  };
  const code = readFileSync(new URL('../mrj-scores.js', import.meta.url), 'utf8');
  vm.runInContext(code, vm.createContext(root));
  return { scores: root.MRJ_SCORES, fetches, root };
}

test('index.html cache-bust ?v= values match mrj-build', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const buildMatch = html.match(/<meta name="mrj-build" content="([^"]+)">/);
  assert.ok(buildMatch, 'mrj-build meta tag');
  const build = buildMatch[1];
  assert.equal(build, SAVE_FIX_BUILD);
  const versioned = [...html.matchAll(/\?v=([^"']+)/g)].map((m) => m[1]);
  assert.ok(versioned.length >= 2, 'expected versioned script/style URLs');
  for (const v of versioned) {
    assert.equal(v, build);
  }
});

test('thrown grade: no noteScore, one CM attempt_error row', () => {
  const noteCalls = [];
  const posts = [];
  const record = {
    scorePct: 0,
    pass: false,
    english: 'It is here.',
    weak: [],
  };
  const result = persistScoredTry({
    itemId: 'basic_a:unit1:line-1',
    record,
    thrown: true,
    failReason: 'Too short. Say the whole English line.',
    studentId: TEST_STUDENT,
    localDateFn: () => '2026-10-11',
    noteScore: (args) => noteCalls.push(args),
    post: (opts) => posts.push(opts),
    titles: { bookTitle: 'Basic A', unitTitle: 'Unit 1' },
  });
  assert.equal(result.noteScoreCalls, 0);
  assert.equal(noteCalls.length, 0);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].itemType, 'attempt_error');
  assert.equal(posts[0].itemId, 'whistle:basic_a:unit1:line-1');
  assert.equal(posts[0].student, TEST_STUDENT);
  assert.equal(posts[0].bookTitle, 'Basic A');
  assert.equal(posts[0].unitTitle, 'Unit 1');
  assert.equal(posts[0].scoreValue, undefined);
  assert.equal(posts[0].metadata.reason, 'Too short. Say the whole English line.');
});

test('graded 64: noteScore whistle item 64/100 with localDate', () => {
  const noteCalls = [];
  const posts = [];
  const record = {
    scorePct: 64,
    pass: false,
    english: 'I can draw a circle',
    weak: ['circle'],
  };
  persistScoredTry({
    itemId: 'basic_a:unit1:line-2',
    record,
    thrown: false,
    failReason: '',
    studentId: TEST_STUDENT,
    localDateFn: () => '2026-10-11',
    noteScore: (args) => noteCalls.push(args),
    post: (opts) => posts.push(opts),
    titles: { bookTitle: 'Basic A', unitTitle: 'Unit 1' },
  });
  assert.equal(noteCalls.length, 1);
  assert.deepEqual(noteCalls[0], {
    program: 'pronounce',
    itemId: 'whistle:basic_a:unit1:line-2',
    scoreValue: 64,
    scoreMax: 100,
    scorePct: 64,
    localDate: '2026-10-11',
  });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].itemType, 'pronunciation');
  assert.equal(posts[0].scoreValue, 64);
  assert.equal(posts[0].scoreMax, 100);
});

test('signed out sends nothing', () => {
  const noteCalls = [];
  const posts = [];
  const record = { scorePct: 80, pass: true, english: 'Hi', weak: [] };
  const result = persistScoredTry({
    itemId: 'basic_a:unit1:line-3',
    record,
    thrown: false,
    failReason: '',
    studentId: '',
    localDateFn: () => '2026-10-11',
    noteScore: (args) => noteCalls.push(args),
    post: (opts) => posts.push(opts),
    titles: { bookTitle: '', unitTitle: '' },
  });
  assert.equal(result.noteScoreCalls, 0);
  assert.equal(noteCalls.length, 0);
  assert.equal(posts.length, 0);
});

test('mrj-scores.post skips fetch when no student', async () => {
  const { scores, fetches } = loadMrjScores('');
  const res = await scores.post({ itemId: 'whistle:test', program: 'pronounce' });
  assert.equal(res.status, 'skipped');
  assert.equal(fetches.length, 0);
});

test('mrj-scores.post uses id_key student_email for non-email sign-in', async () => {
  const { scores, fetches } = loadMrjScores(TEST_STUDENT);
  await scores.post({
    program: 'pronounce',
    itemId: 'whistle:basic_a:unit1:line-1',
    itemType: 'pronunciation',
    scoreValue: 64,
    scoreMax: 100,
    scorePct: 64,
  });
  assert.equal(fetches.length, 1);
  const body = JSON.parse(fetches[0].init.body);
  assert.equal(body.student_email, TEST_STUDENT);
  assert.ok(!body.student_email.includes('unknown'));
  assert.equal(body.events[0].identity_method, 'mrj_signin');
  assert.equal(body.events[0].local_date, scores.localDate());
});

test('noteScoreArgs and CM opts stay aligned on item id', () => {
  const record = { scorePct: 72, pass: true, english: 'Test', weak: [] };
  const note = noteScoreArgs('book:u1:item', record, () => '2026-10-11');
  const cm = gradedCmPostOpts({
    itemId: 'book:u1:item',
    record,
    student: TEST_STUDENT,
    bookTitle: 'B',
    unitTitle: 'U',
  });
  assert.equal(note.itemId, cm.itemId);
  assert.equal(note.itemId, 'whistle:book:u1:item');
});

test('attempt_error CM opts omit numeric scores', () => {
  const opts = attemptErrorCmPostOpts({
    itemId: 'x',
    student: TEST_STUDENT,
    reason: 'mic',
    english: 'Hi',
  });
  assert.equal(opts.itemType, 'attempt_error');
  assert.equal(opts.scoreValue, undefined);
  assert.equal(opts.scoreMax, undefined);
});
