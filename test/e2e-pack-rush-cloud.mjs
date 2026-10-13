/**
 * Verify part-2 rush grades round-trip via MRJ savePack/loadPack (new browser profile).
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import { execSync } from 'child_process';

const BASE = process.env.E2E_BASE || 'https://mrjkorea.github.io/pronounce-whistle/';
const BOOK = 'basic_a';
const UNIT = 'unit01';
const FAKE_WAV = '/tmp/fake-audio.wav';
const PACK_PROGRAM = 'pronounce-whistle';

function makeWav() {
  execSync('espeak-ng -w /tmp/one-raw.wav "one"', { stdio: 'ignore' });
  execSync(`ffmpeg -y -i /tmp/one-raw.wav -ar 48000 -ac 1 ${FAKE_WAV}`, { stdio: 'ignore' });
}

function studentSuffix(studentId) {
  return String(studentId).trim().toLowerCase().replace(/\s+/g, ' ');
}

async function waitCheckerReady(page) {
  await page.waitForFunction(
    () => document.getElementById('modelLabel')?.classList.contains('done'),
    { timeout: 300000 },
  );
}

async function register(page, studentId, password) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Make a new ID' }).click();
  await page.locator('.mrj-auth-input[type="text"]').fill(studentId);
  const pw = page.locator('.mrj-auth-input[type="password"]');
  await pw.nth(0).fill(password);
  await pw.nth(1).fill(password);
  await page.getByRole('button', { name: 'Make my ID' }).click();
  await page.waitForFunction(() => window.MRJ_AUTH?.student?.(), { timeout: 60000 });
}

async function signIn(page, studentId, password) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'I already have an ID' }).click();
  await page.locator('.mrj-auth-input[type="text"]').fill(studentId);
  await page.locator('.mrj-auth-input[type="password"]').first().fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForFunction(
    () => {
      const raw = window.MRJ_AUTH && window.MRJ_AUTH.student();
      return raw != null && String(raw).length > 0;
    },
    { timeout: 60000 },
  );
}

async function seedPart2(page, suffix) {
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
    all[`${book}/${unit}`] = flow;
    localStorage.setItem(flowKey, JSON.stringify(all));
  }, { book: BOOK, unit: UNIT, suffix });
}

async function recordTwoLines(page) {
  const row1Mic = page.locator('article.row').first().locator('.mic');
  const row2Mic = page.locator('article.row').nth(1).locator('.mic');
  await row1Mic.click();
  await page.waitForTimeout(2000);
  await row1Mic.click();
  await page.waitForTimeout(500);
  await row2Mic.click();
  await page.waitForTimeout(2000);
  await row2Mic.click();
  await page.waitForFunction(
    () => {
      const flowKey = Object.keys(localStorage).find((k) => k.startsWith('day4-pronounce-two-parts-v1::zz_test'));
      if (!flowKey) return false;
      const all = JSON.parse(localStorage.getItem(flowKey) || '{}');
      const flow = all['basic_a/unit01'];
      return flow && Object.keys(flow.rushGrades || {}).length >= 2;
    },
    { timeout: 120000 },
  );
}

async function waitForSavePack(page) {
  const resp = await page.waitForResponse(
    async (r) => {
      const data = r.request().postData() || '';
      return r.request().method() === 'POST' && data.includes('save_pack');
    },
    { timeout: 90000 },
  ).catch(() => null);
  if (resp) {
    const body = resp.request().postData() || '';
    return { ok: resp.ok(), snippet: body.slice(0, 500) };
  }
  await page.waitForTimeout(22000);
  return { ok: false, snippet: 'no save_pack seen (waited 22s)' };
}

function readRushGradesFromPage(page, suffix) {
  return page.evaluate(({ suffix, book, unit }) => {
    const flowKey = `day4-pronounce-two-parts-v1::${suffix}`;
    const all = JSON.parse(localStorage.getItem(flowKey) || '{}');
    const flow = all[`${book}/${unit}`] || {};
    return {
      rushGrades: flow.rushGrades || {},
      rushRecorded: flow.rushRecorded || {},
      phase: flow.phase,
    };
  }, { suffix, book: BOOK, unit: UNIT });
}

async function main() {
  makeWav();
  const studentId = `zz_test_cloud_${randomBytes(4).toString('hex')}`;
  const password = randomBytes(10).toString('hex');
  const suffix = studentSuffix(studentId);

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${FAKE_WAV}`,
      '--use-fake-ui-for-media-stream',
    ],
  });

  const ctxA = await browser.newContext({ permissions: ['microphone'] });
  const pageA = await ctxA.newPage();
  let packBodySnippet = '';

  pageA.on('request', (req) => {
    const data = req.postData() || '';
    if (req.method() === 'POST' && data.includes('save_pack')) {
      packBodySnippet = data;
    }
  });

  await register(pageA, studentId, password);
  await waitCheckerReady(pageA);
  await pageA.waitForTimeout(5000);
  const sheetUrl = `${BASE}#/book/${BOOK}/unit/${UNIT}`;
  await seedPart2(pageA, suffix);
  await pageA.goto(sheetUrl);
  await waitCheckerReady(pageA);
  await recordTwoLines(pageA);

  const localA = await readRushGradesFromPage(pageA, suffix);
  const localKeys = Object.keys(localA.rushGrades);
  assert.equal(localKeys.length, 2, `profile A local rush grades: ${localKeys.join(',')}`);

  const saveInfo = await waitForSavePack(pageA);
  const packHasRush = packBodySnippet.includes('rushGrades') && packBodySnippet.includes('basic_a__unit01__01');
  console.log('savePack response ok:', saveInfo.ok, 'body has rushGrades:', packHasRush);

  await ctxA.close();

  const ctxB = await browser.newContext({ permissions: ['microphone'] });
  const pageB = await ctxB.newPage();
  let loadedPack = '';
  pageB.on('response', async (resp) => {
    const data = resp.request().postData() || '';
    if (!data.includes('load_pack')) return;
    try {
      const j = await resp.json();
      if (j && j.progress_json != null) loadedPack = String(j.progress_json);
    } catch (_) {}
  });

  await signIn(pageB, studentId, password);
  await waitCheckerReady(pageB);
  await pageB.waitForTimeout(8000);
  await pageB.goto(sheetUrl);
  await waitCheckerReady(pageB);
  await pageB.waitForTimeout(3000);

  const localB = await readRushGradesFromPage(pageB, suffix);
  const cloudKeys = Object.keys(localB.rushGrades);
  console.log('profile B rush grade keys:', cloudKeys);
  console.log('profile B phase:', localB.phase);
  console.log('loadedPack has rushGrades:', loadedPack.includes('rushGrades'));
  if (loadedPack) {
    console.log('loadedPack snippet:', loadedPack.slice(0, 400));
  }

  const uiMarks = await pageB.evaluate(() => {
    const rows = [...document.querySelectorAll('article.row')].slice(0, 2);
    return rows.map((row) => ({
      checking: !!row.querySelector('.rush-checking'),
      pass: !!row.querySelector('.got-it'),
      fail: !!row.querySelector('.not-yet'),
      text: (row.textContent || '').replace(/\s+/g, ' ').slice(0, 80),
    }));
  });

  const pass = cloudKeys.length >= 2
    && cloudKeys.includes('basic_a__unit01__01')
    && cloudKeys.includes('basic_a__unit01__02')
    && packHasRush
    && (uiMarks[0]?.pass || uiMarks[0]?.fail)
    && (uiMarks[1]?.pass || uiMarks[1]?.fail);

  const evidence = {
    result: pass ? 'PASS' : 'FAIL',
    studentId,
    savePackHadRushGrades: packHasRush,
    profileALocalKeys: localKeys,
    profileBCloudKeys: cloudKeys,
    profileBUiRows: uiMarks,
    serverPackSnippet: loadedPack.slice(0, 300),
  };
  console.log(JSON.stringify(evidence, null, 2));

  await browser.close();

  if (!pass) {
    console.error('FAIL: cloud round-trip incomplete');
    process.exit(1);
  }
  console.log('PASS: part 2 rush grades saved to cloud and restored on new profile');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
