// Whistle on Needle. One model: models/whistle.cact. PCM is 16 kHz mono, -1..1.

const MODEL_URL = new URL('../models/whistle.cact', import.meta.url);
const WASM_BASE = new URL('../vendor/needle/', import.meta.url);
const OUT_CAP = 65536;

function wordsOf(text) {
  const found = String(text || '').match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g);
  return found || [];
}

function wordKey(word) {
  return String(word).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function judgeTranscript(targetText, heardText) {
  const target = wordsOf(targetText)
    .map((word) => ({ word, key: wordKey(word) }))
    .filter((item) => item.key);
  const heard = wordsOf(heardText).map(wordKey).filter(Boolean);
  let matched = 0;
  const words = target.map((item, index) => {
    const match = heard[index] === item.key;
    if (match) matched += 1;
    return { word: item.word, score: match ? 1 : 0, match };
  });
  const score = target.length ? matched / target.length : 0;
  return {
    score,
    scorePct: Math.round(score * 100),
    pass: target.length > 0 && matched === target.length,
    words,
    weak: words.filter((item) => !item.match).map((item) => item.word),
    heard: String(heardText || ''),
  };
}

function keywordLines(targetText) {
  return wordsOf(targetText).join('\n');
}

function writeUtf8(module, text) {
  const value = String(text);
  if (typeof module.lengthBytesUTF8 === 'function' && typeof module.stringToUTF8 === 'function') {
    const bytes = module.lengthBytesUTF8(value) + 1;
    const ptr = module._malloc(bytes);
    module.stringToUTF8(value, ptr, bytes);
    return ptr;
  }
  const encoded = new TextEncoder().encode(value);
  const ptr = module._malloc(encoded.length + 1);
  module.HEAPU8.set(encoded, ptr);
  module.HEAPU8[ptr + encoded.length] = 0;
  return ptr;
}

function writePcm(module, samples) {
  const ptr = module._malloc(samples.length * 4);
  const heap = module.HEAPF32 && module.HEAPF32.buffer === module.HEAPU8.buffer
    ? module.HEAPF32
    : new Float32Array(module.HEAPU8.buffer);
  heap.set(samples, ptr >> 2);
  return ptr;
}

function clampPcm(samples) {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    out[i] = x < -1 ? -1 : x > 1 ? 1 : x;
  }
  return out;
}

function transcribePcm(module, samples, targetText) {
  const pcm = clampPcm(samples);
  const pcmPtr = writePcm(module, pcm);
  const langPtr = writeUtf8(module, 'en');
  const kwPtr = writeUtf8(module, keywordLines(targetText));
  const outPtr = module._malloc(OUT_CAP);
  try {
    module.HEAPU8.fill(0, outPtr, outPtr + OUT_CAP);
    module._needle_transcribe(pcmPtr, pcm.length, langPtr, kwPtr, 1, outPtr, OUT_CAP);
    const json = module.UTF8ToString(outPtr);
    let parsed;
    try {
      parsed = JSON.parse(json || '');
    } catch (_) {
      const errPtr = module._needle_last_error();
      const detail = errPtr ? module.UTF8ToString(errPtr) : '';
      throw new Error(detail || 'Whistle did not write a transcript');
    }
    return String(parsed.text || '');
  } finally {
    module._free(pcmPtr);
    module._free(langPtr);
    module._free(kwPtr);
    module._free(outPtr);
  }
}

async function readBody(res, onChunk) {
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.byteLength;
    onChunk(got);
  }
  const out = new Uint8Array(got);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function loadWhistle(createNeedle, onProgress) {
  if (typeof createNeedle !== 'function') throw new Error('Whistle runtime missing');
  const module = await createNeedle({
    locateFile(file) {
      return new URL(file, WASM_BASE).href;
    },
  });
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error('Whistle model missing');
  const total = Number(res.headers.get('content-length')) || 16919407;
  const bytes = await readBody(res, (got) => {
    if (onProgress) onProgress(Math.min(1, got / total));
  });
  const ptr = module._malloc(bytes.byteLength);
  module.HEAPU8.set(bytes, ptr);
  const rc = module._needle_load(ptr, BigInt(bytes.byteLength));
  module._free(ptr);
  if (rc !== 0) throw new Error('Whistle did not load');
  if (module._needle_models() !== 2) throw new Error('Whistle models did not load');
  return module;
}

export {
  wordsOf,
  wordKey,
  judgeTranscript,
  transcribePcm,
  loadWhistle,
};
