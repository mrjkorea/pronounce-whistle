# CURSOR_RECEIPT — Pronounce Whistle

Date: 4 Oct 2026
Workspace: `/Users/andreclouthier/.hermes/projects/pronounce-whistle`
Model that wrote the page: grok-4.7

## Speech model

- Name: Whistle
- File: `models/whistle.cact` (16.9 MB)
- Engine: `vendor/needle/needle.js` + `vendor/needle/needle.wasm`
- Job: write the words, then match them to the target line
- No phone speech engine
- No wav2vec file

## Test

Node loaded the model. `_needle_load` returned 0. `_needle_models` returned 2.
The clip `audio/hear/it-is-here.mp3` transcribed as `It is here.`

## Not here

Phonon-2 is not in this folder. That model has no browser engine.

After a saved try, the full English sentence shows on pass and fail, each word green or red, with large PASS or "Not yet", the heard text under the sentence, and word chips on every saved result.
