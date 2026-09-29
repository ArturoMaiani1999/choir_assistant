// Configuration for the local development server. The production build writes
// its own file and never ships this one.
window.ChoirRuntimeConfig = Object.freeze({
  mode: 'development',
  libraryUrl: '/api/library',
  bundleUrlTemplate: '/api/library/{pieceId}/bundle',
  transposeUrlTemplate: '/api/transpose?file={file}&semitones={semitones}',
  benchmarkEventUrl: '/api/benchmark-event',
  crepeModelUrl: 'models/crepe_onnx_tiny.onnx',
  crepeRuntimeScriptUrl: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.0/dist/ort.min.js',
  crepeRuntimeBaseUrl: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.0/dist/',
  features: Object.freeze({ diagnostics: true, crepe: true, transpose: true }),
});
