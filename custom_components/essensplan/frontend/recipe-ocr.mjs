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

export async function recognizeRecipe(files, progress = () => {}, signal) {
  if (files.length < 1 || files.length > 3) throw new Error('Wähle ein bis drei Screenshots.');
  for (const file of files) {
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || !file.size || file.size > 20*1024*1024) {
      throw new Error('Wähle Screenshots als PNG, JPEG oder WebP (bis 20 MB pro Bild).');
    }
  }
  signal?.throwIfAborted();
  const Tesseract = await loadEngine();
  signal?.throwIfAborted();
  const local = location.origin + assets;
  let index=0;
  const worker = await Tesseract.createWorker('deu', 1, {
    workerPath: local + '/worker.min.js',
    corePath: local + '/tesseract-core-lstm.wasm.js',
    langPath: local,
    gzip: false,
    workerBlobURL: false,
    cacheMethod: 'none',
    logger: event => {
      if (event.status === 'recognizing text') progress(index+1,Math.round(event.progress * 100));
    },
  });
  const result={lines:[],steps:[],uncertain:[],uncertainSteps:[],previews:[]};
  let section='';
  try {
    for (const file of files) {
      if (signal?.aborted) break;
      const bitmap=await createImageBitmap(file);
      try {
        if (bitmap.width * bitmap.height > 25000000) throw new Error('Ein Screenshot ist zu groß. Schneide ihn bitte zu.');
        const {data}=await worker.recognize(file, {}, {text:true,blocks:true});
        if (signal?.aborted) break;
        const page=extractRecipePage(data.text.slice(0,16000),section);
        section=page.section;
        appendOverlap(result.lines,page.lines);
        appendOverlap(result.steps,page.steps);
        const rows=(data.blocks || []).flatMap(block=>block.paragraphs.flatMap(paragraph=>paragraph.lines));
        for (const [kind, selected] of [['ingredients',page.lines],['steps',page.stepRows]]) {
          const matched=rows.filter(row=>selected.includes(kind==='steps'?cleanRow(row.text.trim()):row.text.trim().replace(bullet,'').trim()));
          const preview=await previewCrop(bitmap,matched.map(row=>row.bbox));
          if (preview) result.previews.push({kind,index,preview});
          const uncertain=matched.filter(row=>row.confidence<80).map(row=>cleanRow(row.text.trim()));
          if (kind==='ingredients') result.uncertain.push(...uncertain);
          else result.uncertainSteps.push(...uncertain);
        }
        if (page.assumedSteps) result.uncertainSteps.push(...page.steps);
      } finally { bitmap.close(); }
      index++;
    }
    return result;
  } finally { await worker.terminate(); }
}

async function previewCrop(bitmap,boxes) {
  if (!boxes.length) return null;
  const padding=12;
  const x=Math.max(0,Math.min(...boxes.map(b=>b.x0))-padding);
  const y=Math.max(0,Math.min(...boxes.map(b=>b.y0))-padding);
  const width=Math.min(bitmap.width,Math.max(...boxes.map(b=>b.x1))+padding)-x;
  const height=Math.min(bitmap.height,Math.max(...boxes.map(b=>b.y1))+padding)-y;
  if (width<=0 || height<=0) return null;
  const scale=Math.min(1,1400/Math.max(width,height));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
  canvas.getContext('2d').drawImage(bitmap,x,y,width,height,0,0,canvas.width,canvas.height);
  return new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
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

export function uncertainAmount(line) {
  return /^(?:\d+[.,]?\d*\s*[-–]\s*\d+|[IlO]\s+(?:g|kg|ml|l|el|tl)\b)|\d\s*mi\b/i.test(line)
    || /^\d+(?:[.,]\d+)?\s*(?:EL|TL|ML|KG|G)(?=\p{L})/u.test(line)
    || (/^[\d½¼¾⅓⅔⅛]/.test(line) && !ingredient(line).quantity);
}

const stepHeading = /^(?:zubereitung|anleitung|schritte|so geht(?:['’]s| es))(?:\s*[:：]\s*(.*)|\s*)$/i;
const stepNumber = /^(?:schritt\s+)?\d{1,2}[.)：:]\s+/i;
const cleanRow = line => line.replace(bullet,'').replace(stepNumber,'').trim();
const stopSteps = /^(?:nährwerte|tipps?|notizen|kommentare|mehr anzeigen|speichern|folge mir|viel spaß|guten appetit|lass es dir schmecken)(?:\b|[:：])/i;
const lineKey = line => line.normalize('NFKC').toLocaleLowerCase('de').trim().replace(/\s+/g,' ');

export function appendOverlap(target, incoming) {
  let overlap=Math.min(target.length,incoming.length);
  while (overlap && !incoming.slice(0,overlap).every((line,i)=>lineKey(line)===lineKey(target[target.length-overlap+i]))) overlap--;
  target.push(...incoming.slice(overlap));
}

export function extractRecipePage(text, previous = '') {
  const rows=linesOf(text);
  const ingredientAt=rows.findIndex(line=>start.test(headingText(line)));
  const stepAt=rows.findIndex(line=>stepHeading.test(headingText(line)));
  const beforeSteps=stepAt<0?rows:rows.slice(0,stepAt);
  const ingredientRows=beforeSteps.join('\n');
  let lines=extractIngredientLines(ingredientRows);
  if (!lines.length && previous==='ingredients' && ingredientAt<0) {
    const listStart=beforeSteps.findIndex(line=>bullet.test(line) || ingredient(line).quantity);
    if (listStart>=0) {
      const continuation=[];
      for (const line of beforeSteps.slice(listStart)) {
        if (footer.test(line) || end.test(headingText(line))) break;
        if (subsection.test(headingText(line)) || /[:：]$/.test(line)) continue;
        if (!bullet.test(line) && !ingredient(line).quantity) break;
        continuation.push(line);
      }
      lines=extractIngredientLines(continuation.join('\n'));
    }
  }

  const firstNumbered=rows.findIndex(line=>stepNumber.test(line) && !footer.test(line));
  const continued=stepAt<0 && ingredientAt<0 && firstNumbered>=0 &&
    (previous==='steps' || firstNumbered===0 && rows.filter(line=>stepNumber.test(line)).length>=2);
  const steps=[], stepRows=[];
  let section=lines.length?'ingredients':previous;
  if (stepAt>=0 || continued) {
    section='steps';
    const heading=stepAt>=0?headingText(rows[stepAt]).match(stepHeading):null;
    const content=stepAt>=0?[heading[1], ...rows.slice(stepAt+1)].filter(Boolean):rows.slice(firstNumbered);
    let numbered=false;
    for (const row of content) {
      const heading=headingText(row);
      if (footer.test(row) || stopSteps.test(heading) || start.test(heading)) {section='';break;}
      const marked=stepNumber.test(row) || bullet.test(row);
      const line=cleanRow(row);
      if (!/\p{L}/u.test(line)) continue;
      stepRows.push(line);
      if (!marked && numbered && steps.length) steps[steps.length-1]+=' '+line;
      else steps.push(line);
      numbered=marked || numbered;
    }
    if (continued) lines=[];
  }
  return {lines,steps,stepRows,section,assumedSteps:continued};
}
