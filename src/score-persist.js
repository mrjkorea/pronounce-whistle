export const SAVE_FIX_BUILD = '20261013-e5f1';

export function whistleItemId(itemId) {
  return 'whistle:' + itemId;
}

export function noteScoreArgs(itemId, record, localDateFn) {
  const scorePct = Math.round(Number(record.scorePct || 0));
  return {
    program: 'pronounce',
    itemId: whistleItemId(itemId),
    scoreValue: scorePct,
    scoreMax: 100,
    scorePct,
    localDate: localDateFn(),
  };
}

export function gradedCmPostOpts({ itemId, record, student, bookTitle, unitTitle }) {
  return {
    student,
    program: 'pronounce',
    appName: 'Pronounce · Whistle',
    source: 'pronounce',
    itemId: whistleItemId(itemId),
    itemType: 'pronunciation',
    bookTitle: bookTitle || '',
    unitTitle: unitTitle || '',
    scoreValue: Math.round(Number(record.scorePct || 0)),
    scoreMax: 100,
    scorePct: Math.round(Number(record.scorePct || 0)),
    correctness: record.pass ? 'correct' : 'incorrect',
    metadata: { english: record.english || '', weak: record.weak || [] },
  };
}

export function attemptErrorCmPostOpts({ itemId, student, bookTitle, unitTitle, reason, english }) {
  return {
    student,
    program: 'pronounce',
    appName: 'Pronounce · Whistle',
    source: 'pronounce',
    itemId: whistleItemId(itemId),
    itemType: 'attempt_error',
    bookTitle: bookTitle || '',
    unitTitle: unitTitle || '',
    metadata: { reason: reason || '', english: english || '' },
  };
}

/** @returns {{ noteScoreCalls: number, cmPosts: object[] }} */
export function persistScoredTry({
  itemId,
  record,
  thrown,
  failReason,
  studentId,
  localDateFn,
  noteScore,
  post,
  titles,
}) {
  if (!itemId || !studentId) {
    return { noteScoreCalls: 0, cmPosts: [] };
  }
  const cmPosts = [];
  if (thrown) {
    const opts = attemptErrorCmPostOpts({
      itemId,
      student: studentId,
      bookTitle: titles.bookTitle,
      unitTitle: titles.unitTitle,
      reason: failReason,
      english: record.english,
    });
    post(opts);
    cmPosts.push(opts);
    return { noteScoreCalls: 0, cmPosts };
  }
  noteScore(noteScoreArgs(itemId, record, localDateFn));
  const opts = gradedCmPostOpts({
    itemId,
    record,
    student: studentId,
    bookTitle: titles.bookTitle,
    unitTitle: titles.unitTitle,
  });
  post(opts);
  cmPosts.push(opts);
  return { noteScoreCalls: 1, cmPosts };
}
