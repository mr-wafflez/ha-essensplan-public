const assets = '/essensplan_static/ocr';
let engine;

function loadEngine() {
  if (!engine) {
    engine = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = assets + '/tesseract.min.js';
      script.onload = () => globalThis.Tesseract ? resolve(globalThis.Tesseract) : reject(new Error('OCR nicht verfügbar.'));
      script.onerror = () => reject(new Error('Die lokale Texterkennung konnte nicht geladen werden.'));
      document.head.append(script);
    }).catch(error => { engine = undefined; throw error; });
  }
  return engine;
}

export async function recognizeRecipe(file, progress = () => {}) {
  if (!['image/png','image/jpeg','image/webp'].includes(file.type) || !file.size || file.size > 20*1024*1024) {
    throw new Error('Wähle einen Screenshot als PNG, JPEG oder WebP (bis 20 MB).');
  }
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 25000000) throw new Error('Der Screenshot ist zu groß. Schneide ihn bitte zu.');
  } finally { bitmap.close(); }
  const Tesseract = await loadEngine();
  const local = location.origin + assets;
  const worker = await Tesseract.createWorker('deu', 1, {
    workerPath: local + '/worker.min.js',
    corePath: local + '/tesseract-core-lstm.wasm.js',
    langPath: local,
    gzip: false,
    workerBlobURL: false,
    cacheMethod: 'none',
    logger: event => {
      if (event.status === 'recognizing text') progress(Math.round(event.progress * 100));
    },
  });
  try {
    const {data} = await worker.recognize(file);
    return data.text.trim();
  } finally { await worker.terminate(); }
}

const units = new Map(Object.entries({
  g:'g', gramm:'g', kg:'kg', ml:'ml', mi:'ml', l:'l', liter:'l',
  stück:'stück', stk:'stück', st:'stück', el:'el', esslöffel:'el',
  tl:'tl', teelöffel:'tl', prise:'prise', prisen:'prise',
  bund:'bund', dose:'dose', dosen:'dose',
}));
const fractions = {'½':'1/2','¼':'1/4','¾':'3/4','⅓':'1/3','⅔':'2/3','⅛':'1/8'};

// OCR often reads small bullets as guillemets, a plus sign or a middle dot.
const bullet = /^(?:[-–—•*▪◦·∙⋅+«»]\s*|[.]\s+)(?=\S)/;
const start = /^(?:zutaten(?:liste)?|was du brauchst)(?:\s+(?:für\b.*|\(.*\)))?\s*[:：]?$/i;
const end = /^(?:zubereitung|anleitung|schritte|so geht(?:['’]s| es)|nährwerte|tipps?|notizen|kommentare|mehr anzeigen)(?:\b|[:：])/i;
const footer = /^(?:[#@]|\d{1,2}\.\s*(?:januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember)\b|folgen\b|gefällt mir\b)/i;
const subsection = /^für\s+.+[:：]$/i;
const headingText = line => line.replace(/^[^\p{L}]+/u, '').trim();

function ingredient(line) {
  const original = line.replace(bullet, '').trim();
  const normalized = original.replace(/[½¼¾⅓⅔⅛]/g, (part, index) =>
    (index && /\d/.test(original[index-1]) ? ' ' : '') + fractions[part]);
  const match = normalized.match(/^(?:(\d+)\s+)?(\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?)(?:\s+|(?=[a-zäöü]))(.+)$/i);
  const unknown = {name:original,quantity:'',unit:''};
  if (!match || (/^[-–/]/.test(match[3]))) return unknown;
  const amount = match[2];
  if (match[1] && !amount.includes('/')) return unknown;
  const [top,bottom] = amount.split('/').map(Number);
  const number = amount.includes('/') ? Number(match[1] || 0) + top/bottom : Number(amount.replace(',','.'));
  if (!Number.isFinite(number) || number < .001 || number > 1000000) return unknown;
  const name = match[3].trim();
  const first = name.match(/^([a-zäöüß]+)\.?\s+(.+)$/i);
  const unit = first && units.get(first[1].toLowerCase());
  return {name:unit ? first[2] : name, quantity:String(Number(number.toFixed(3))), unit:unit || ''};
}

const linesOf = text => text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

export function extractIngredientLines(text) {
  const lines = linesOf(text);
  const heading = lines.findIndex(line => start.test(headingText(line)));
  // Without a heading, accept only a tightly cropped, clearly marked list.
  if (heading < 0 && (!lines.length || !lines.every(line => subsection.test(line) ||
    bullet.test(line) || ingredient(line).quantity))) return [];
  const result = [];
  let listed = false;
  for (let index=heading+1;index<lines.length;index++) {
    const line = lines[index], heading = headingText(line);
    if (end.test(heading) || footer.test(line)) break;
    if (subsection.test(heading) || start.test(heading)) continue;
    if (/[:：]$/.test(heading)) {
      // A short label such as “Sauce:” is a subgroup only if a list follows it.
      const next=lines[index+1];
      if (heading.split(/\s+/).length <= 6 && next &&
          (bullet.test(next) || ingredient(next).quantity) && !end.test(headingText(next))) continue;
      break;
    }
    const marked = bullet.test(line);
    const parsed = ingredient(line);
    if (!parsed.name || !/\p{L}/u.test(parsed.name)) continue;
    if (!marked && !parsed.quantity && (listed || /[.!?]$/.test(line) || line.split(/\s+/).length > 8)) break;
    result.push(line.replace(bullet, '').trim());
    listed ||= marked;
  }
  return result;
}

export function parseIngredientLines(text) {
  return linesOf(text).flatMap(line => {
    const parts = line.split(/\s+(?:&|und)\s+(?=[\d½¼¾⅓⅔⅛])/i);
    const items = parts.map(ingredient);
    // Split “1 Zwiebel & 2 Knoblauchzehen”, but keep “Salz & Pfeffer”.
    return items.every(item => item.quantity) ? items : [ingredient(line)];
  }).filter(item => item.name);
}
