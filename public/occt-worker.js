// Web Worker: parsing STEP com OpenCASCADE (WASM) fora da thread de UI.
// Erros são etiquetados por fase: 'init' (runtime não carregou — worker
// inutilizável) vs 'parse' (arquivo problemático — worker segue confiável).
let occtPromise = null;

self.onmessage = function (e) {
  const { id, buffer, params } = e.data;
  let phase = 'init';
  Promise.resolve()
    .then(() => {
      if (!occtPromise) {
        importScripts('./vendor/occt-import-js.js');
        occtPromise = self.occtimportjs({
          locateFile: (file) => './vendor/' + file
        });
      }
      return occtPromise;
    })
    .then((occt) => {
      phase = 'parse';
      const result = occt.ReadStepFile(new Uint8Array(buffer), params || null);
      self.postMessage({ id, ok: true, result });
    })
    .catch((err) => {
      occtPromise = null; // um abort do WASM inutiliza o runtime deste worker
      self.postMessage({
        id, ok: false, phase,
        error: String((err && err.message) || err)
      });
    });
};
