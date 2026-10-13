# Pronounce · Citrinet

Day 4 pronunciation sheet. Citrinet forced-alignment word scores in the browser (int8 ONNX, onnxruntime-web WASM). Pass at 60. A “say it again” gate uses the greedy Citrinet transcript (50% word overlap).

Live: https://mrjkorea.github.io/pronounce-whistle/

## Dev

```bash
npm test
npm run bench   # headless Chrome + fake mic WAVs
```
