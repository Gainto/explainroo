// An app can take over the word timing: EXPLAINROO_TRANSCRIBE_MODULE names a
// module whose transcribeWords answers instead of local Whisper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('transcribeWords goes to the module EXPLAINROO_TRANSCRIBE_MODULE names', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-hook-'));
  const file = path.join(dir, 'hook.mjs');
  fs.writeFileSync(file, 'export async function transcribeWords(samples, options) { return { text: "hooked", words: [{ text: "hooked", start: 0, end: samples.length / 16000 }], language: options.language }; }\n');
  const before = process.env.EXPLAINROO_TRANSCRIBE_MODULE;
  process.env.EXPLAINROO_TRANSCRIBE_MODULE = file;
  try {
    const { transcribeWords } = await import('../src/models.js');
    const result = await transcribeWords(new Float32Array(16000), { language: 'de' });
    assert.deepEqual(result, { text: 'hooked', words: [{ text: 'hooked', start: 0, end: 1 }], language: 'de' });
  } finally {
    if (before === undefined) delete process.env.EXPLAINROO_TRANSCRIBE_MODULE;
    else process.env.EXPLAINROO_TRANSCRIBE_MODULE = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('whisperTranscribeWords is exported for an app that wants local Whisper itself', async () => {
  const models = await import('../src/models.js');
  assert.equal(typeof models.whisperTranscribeWords, 'function');
});
