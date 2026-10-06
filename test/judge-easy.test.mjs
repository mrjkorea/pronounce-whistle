import assert from 'node:assert/strict';
import test from 'node:test';
import { judgeTranscript } from '../src/whistle.js';

const TARGET = 'I can draw a circle';

test('exact line passes at 100 in order and 100 same words', () => {
  const judged = judgeTranscript(TARGET, 'I can draw a circle');
  assert.equal(judged.pass, true);
  assert.equal(judged.orderPct, 100);
  assert.equal(judged.samePct, 100);
  assert.equal(judged.scorePct, 100);
});

test('one swapped word passes on the 70 percent in-order rule', () => {
  const judged = judgeTranscript(TARGET, 'I can draw a star');
  assert.equal(judged.orderPct, 80);
  assert.equal(judged.pass, true);
});

test('reordered words pass on the 50 percent same-word rule', () => {
  const judged = judgeTranscript(TARGET, 'I draw a circle');
  assert.ok(judged.orderPct < 70);
  assert.ok(judged.samePct >= 50);
  assert.equal(judged.samePct, 80);
  assert.equal(judged.pass, true);
});

test('unrelated word fails with both percents at 0', () => {
  const judged = judgeTranscript(TARGET, 'banana');
  assert.equal(judged.orderPct, 0);
  assert.equal(judged.samePct, 0);
  assert.equal(judged.pass, false);
});

test('empty heard line fails', () => {
  const judged = judgeTranscript(TARGET, '');
  assert.equal(judged.pass, false);
});

test('repeated target words do not share one heard copy', () => {
  const judged = judgeTranscript('a a cat', 'a cat');
  assert.equal(judged.samePct, 67);
  assert.notEqual(judged.samePct, 100);
  assert.equal(judged.words[0].match, true);
  assert.equal(judged.words[1].match, false);
  assert.equal(judged.words[1].orderMatch, false);
  assert.equal(judged.words[2].match, true);
});
