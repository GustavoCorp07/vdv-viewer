// Carregamento de arquivos STEP com OpenCASCADE (WASM).
// Estratégia: Web Worker (UI nunca congela) com fallback para thread principal
// apenas quando o WORKER em si falha (não quando o arquivo é inválido).
// Também extrai do texto STEP os nomes reais dos sólidos (MANIFOLD_SOLID_BREP),
// que o occt-import-js não propaga para as meshes.

const OCCT_PARAMS = {
  linearUnit: 'millimeter',
  linearDeflectionType: 'bounding_box_ratio',
  linearDeflection: 0.001,
  angularDeflection: 0.5
};

let worker = null;
let workerBroken = false;
let msgId = 0;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker('./occt-worker.js');
  worker.onmessage = (e) => {
    const { id, ok, result, error, phase } = e.data;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (ok) p.resolve(result);
    else p.reject(Object.assign(new Error(error), { phase: phase || 'parse' }));
  };
  worker.onerror = (e) => {
    workerBroken = true;
    for (const [, p] of pending) {
      p.reject(Object.assign(new Error('Worker falhou: ' + e.message), { phase: 'init' }));
    }
    pending.clear();
    try { worker.terminate(); } catch (_) { /* noop */ }
    worker = null;
  };
  return worker;
}

function parseInWorker(buffer) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    try {
      getWorker().postMessage({ id, buffer, params: OCCT_PARAMS }, [buffer]);
    } catch (err) {
      pending.delete(id);
      err.phase = 'init';
      reject(err);
    }
  });
}

// ---------- Fallback: thread principal ----------
let mainOcctPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Falha ao carregar ' + src));
    document.head.appendChild(s);
  });
}

async function parseInMain(buffer) {
  if (!mainOcctPromise) {
    mainOcctPromise = (async () => {
      if (!window.occtimportjs) await loadScript('./vendor/occt-import-js.js');
      return window.occtimportjs({ locateFile: (f) => './vendor/' + f });
    })().catch((e) => { mainOcctPromise = null; throw e; });
  }
  const occt = await mainOcctPromise;
  return occt.ReadStepFile(new Uint8Array(buffer), OCCT_PARAMS);
}

/** Decodifica escapes de string ISO-10303-21: '' → ', \S\c, \X2\hhhh\X0\. */
function decodeStepString(s) {
  return s
    .replace(/''/g, "'")
    .replace(/\\X2\\((?:[0-9A-Fa-f]{4})+)\\X0\\/g, (_, hex) => {
      let out = '';
      for (let i = 0; i < hex.length; i += 4) {
        out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
      }
      return out;
    })
    .replace(/\\X\\([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\S\\(.)/g, (_, c) => String.fromCharCode(c.charCodeAt(0) + 128))
    .trim();
}

/**
 * Extrai, na ordem do arquivo, os nomes dos sólidos declarados em
 * MANIFOLD_SOLID_BREP('nome', ...). É assim que TopSolid/SolidWorks gravam o
 * nome de cada peça quando o produto inteiro é um único PRODUCT.
 */
function extractBrepNames(buffer) {
  try {
    // decodifica no máximo ~64 MB como latin1 (entidades STEP são ASCII)
    const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 64 * 1024 * 1024));
    const text = new TextDecoder('latin1').decode(bytes);
    const names = [];
    const re = /MANIFOLD_SOLID_BREP\s*\(\s*'((?:[^']|'')*)'/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      names.push(decodeStepString(m[1]));
    }
    return names;
  } catch (_) {
    return [];
  }
}

/**
 * @param {ArrayBuffer} buffer conteúdo do arquivo .step/.stp
 * @returns {Promise<object>} resultado do occt-import-js ({ success, root, meshes,
 *          brepNames — nomes reais dos sólidos na ordem do arquivo })
 */
export async function parseStep(buffer) {
  const brepNames = extractBrepNames(buffer);
  let result;
  if (!workerBroken && typeof Worker !== 'undefined') {
    try {
      // o buffer é transferido; clona antes para preservar o original
      const copy = buffer.slice(0);
      result = await parseInWorker(copy);
    } catch (err) {
      if (err.phase === 'init') {
        // o worker em si não funciona neste ambiente → fallback definitivo
        console.warn('[VdvView] Worker indisponível, usando thread principal:', err);
        workerBroken = true;
        result = await parseInMain(buffer);
      } else {
        // erro de PARSE: o arquivo é o problema, não o worker.
        // Recria o worker (um abort do WASM inutiliza aquele runtime).
        try { worker && worker.terminate(); } catch (_) { /* noop */ }
        worker = null;
        throw new Error('O OpenCASCADE não conseguiu interpretar este arquivo STEP. ' +
          '(' + err.message + ')');
      }
    }
  } else {
    result = await parseInMain(buffer);
  }
  if (!result || !result.success) {
    throw new Error('O OpenCASCADE não conseguiu interpretar este arquivo STEP.');
  }
  if (!result.meshes || !result.meshes.length) {
    throw new Error('O arquivo foi lido, mas não contém geometria 3D visível.');
  }
  result.brepNames = brepNames;
  return result;
}
