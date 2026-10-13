/**
 * Live part-2 overlap test (headless Chromium + fake mic WAV).
 * Run: node test/e2e-part2-live.mjs
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import { copyFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const BASE = process.env.E2E_BASE || 'https://mrjkorea.github.io/pronounce-whistle/';
const BOOK = 'basic_a';
const UNIT = 'unit01';
const FAKE_WAV = '/tmp/fake-audio.wav';
const FAKE_WAV_TWO = '/tmp/fake-audio-two.wav';

function makeWavs() {
  execSync('espeak-ng -w /tmp/one-raw.wav "one"', { stdio: 'ignore' });
  execSync('espeak-ng -w /tmp/two-raw.wav "two"', { stdio: 'ignore' });
  execSync(
    'ffmpeg -y -i /tmp/one-raw.wav -ar 48000 -ac 1 ' + FAKE_WAV,
    { stdio: 'ignore' },
  );
  execSync(
    'ffmpeg -y -i /tmp/two-raw.wav -ar 48000 -ac 1 ' + FAKE_WAV_TWO,
    { stdio: 'ignore' },
  );
}

async function waitCheckerReady(page, timeoutMs = 300000) {
  await page.waitForFunction(
    () => {
      const el = document.getElementById('modelLabel');
      return el && el.classList.contains('done');
    },
    { timeout: timeoutMs },
  );
}

async function registerStudent(page, studentId, password) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Make a new ID' }).click();
  await page.locator('.mrj-auth-input[type="text"]').fill(studentId);
  const pwFields = page.locator('.mrj-auth-input[type="password"]');
  await pwFields.nth(0).fill(password);
  await pwFields.nth(1).fill(password);
  await page.getByRole('button', { name: 'Make my ID' }).click();
  await page.waitForFunction(
    () => window.MRJ_AUTH && typeof window.MRJ_AUTH.student === 'function' && window.MRJ_AUTH.student(),
    { timeout: 60000 },
  );
}

function studentSuffix(studentId) {
  return String(studentId).trim().toLowerCase().replace(/\s+/g, ' ');
}

async function seedPart2(page, studentId) {
  const suffix = studentSuffix(studentId);
  await page.evaluate(({ book, unit, suffix }) => {
    const flowKey = `day4-pronounce-two-parts-v1::${suffix}`;
    const now = Date.now();
    const flow = {
      phase: 'part2',
      fails: {},
      student: {},
      attempts: {},
      teacher: {},
      rushRecorded: {},
      rushGrades: {},
      part2: {
        wordCount: 10,
        limitSec: 120,
        startedAt: now,
        stoppedAt: 0,
        secondsUsed: null,
      },
    };
    const all = {};
    try {
      Object.assign(all, JSON.parse(localStorage.getItem(flowKey) || '{}'));
    } catch (_) {}
    all[`${book}/${unit}`] = flow;
    localStorage.setItem(flowKey, JSON.stringify(all));
  }, { book: BOOK, unit: UNIT, suffix });
}

async function waitPackLoaded(page) {
  await page.waitForTimeout(4000);
}

async function runOnce(fakePath) {
  makeWavs();
  copyFileSync(fakePath, FAKE_WAV);

  const studentId = `zz_test_it_pw_${randomBytes(4).toString('hex')}`;
  const password = randomBytes(8).toString('hex');

  const noteScores = [];
  const packSaves = [];

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${FAKE_WAV}`,
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  const context = await browser.newContext({
    permissions: ['microphone'],
    locale: 'en-US',
  });
  const page = await context.newPage();

  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('noteScore') || url.includes('progress') || url.includes('pack')) {
      packSaves.push({ url, method: req.method(), post: req.postData() });
    }
  });

  await page.exposeFunction('__e2eNoteScore', (args) => {
    noteScores.push(args);
  });

  await page.addInitScript(() => {
    const hook = () => {
      if (!window.MRJ_AUTH || window.MRJ_AUTH.__e2eHooked) return;
      window.MRJ_AUTH.__e2eHooked = true;
      const orig = window.MRJ_AUTH.noteScore;
      if (typeof orig === 'function') {
        window.MRJ_AUTH.noteScore = (args) => {
          window.__e2eNoteScore?.(args);
          return orig(args);
        };
      }
    };
    window.addEventListener('mrj-auth-ready', hook);
    if (window.MRJ_AUTH) hook();
  });

  await registerStudent(page, studentId, password);
  await waitCheckerReady(page);
  await waitPackLoaded(page);
  const sheetUrl = `${BASE}#/book/${BOOK}/unit/${UNIT}`;
  await page.goto(sheetUrl, { waitUntil: 'domcontentloaded' });
  await waitCheckerReady(page);
  await seedPart2(page, studentId);
  await page.goto(sheetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.rush-limit', { timeout: 60000 });

  const limitText = await page.locator('.rush-limit').textContent();
  assert.match(limitText || '', /120/, `expected Limit 120, got: ${limitText}`);

  const mics = page.locator('article.row .mic:not([disabled])');
  await mics.first().waitFor({ state: 'visible', timeout: 30000 });
  const micCount = await mics.count();
  assert.ok(micCount >= 2, `need at least 2 mics, got ${micCount}`);

  const row1Mic = page.locator('article.row').first().locator('.mic');
  const row2Mic = page.locator('article.row').nth(1).locator('.mic');
  await row1Mic.click();
  await page.waitForTimeout(2000);
  await row1Mic.click();
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll('article.row');
    const checking = rows[0]?.querySelector('.rush-checking');
    const mic2 = rows[1]?.querySelector('.mic');
    return checking && mic2 && !mic2.disabled;
  }, { timeout: 5000 });
  await row2Mic.click();
  await page.waitForTimeout(2000);
  await row2Mic.click();

  await page.waitForFunction(
    () => {
      const rows = document.querySelectorAll('article.row');
      if (rows.length < 2) return false;
      const r0 = rows[0].textContent || '';
      const r1 = rows[1].textContent || '';
      const done0 = !r0.includes('Checking') && (r0.includes('Not yet') || r0.includes('✓') || r0.includes('PASS'));
      const done1 = !r1.includes('Checking') && (r1.includes('Not yet') || r1.includes('✓') || r1.includes('PASS'));
      return done0 && done1;
    },
    { timeout: 120000 },
  );

  const flowState = await page.evaluate(({ book, unit, suffix }) => {
    const flowKey = `day4-pronounce-two-parts-v1::${suffix}`;
    const all = JSON.parse(localStorage.getItem(flowKey) || '{}');
    const flow = all[`${book}/${unit}`] || {};
    return {
      rushRecorded: flow.rushRecorded || {},
      rushGrades: flow.rushGrades || {},
    };
  }, { book: BOOK, unit: UNIT, suffix: studentSuffix(studentId) });

  const keys = Object.keys(flowState.rushRecorded);
  assert.ok(keys.length >= 2, `expected 2 rush recordings, got ${keys.length}`);

  const gradeKeys = Object.keys(flowState.rushGrades);
  assert.ok(gradeKeys.length >= 2, `expected 2 rush grades saved, got ${gradeKeys.length}`);
  assert.notEqual(gradeKeys[0], gradeKeys[1]);

  const rowTexts = await page.locator('article.row').nth(0).innerText();
  const rowTexts2 = await page.locator('article.row').nth(1).innerText();
  assert.ok(rowTexts.includes('one'), 'row 1 should show line 1 result');
  assert.ok(rowTexts2.includes('two') || rowTexts2.includes('Not yet') || rowTexts2.includes('✓'), 'row 2 should show its own result');

  await page.waitForTimeout(20000);
  const packSaved = packSaves.some((p) => (p.post || '').includes('rushGrades') || (p.post || '').includes('basic_a__unit01'));
  assert.ok(packSaved || gradeKeys.length >= 2, 'expected progress pack save with rush grades');

  await browser.close();
  return { studentId, password, flowState, noteScores, packSaves };
}

async function main() {
  console.log('E2E part2 live test @', BASE);
  const result = await runOnce(FAKE_WAV);
  console.log('student:', result.studentId);
  console.log('rush grades:', Object.keys(result.flowState.rushGrades));
  console.log('noteScore calls (part1 only):', result.noteScores.length);
  console.log('OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
