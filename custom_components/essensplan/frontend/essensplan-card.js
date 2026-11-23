/* Essensplan 0.15.0 – bundled with the integration; no CDN or build step. */
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const localDate = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
function offsetDay(stamp, n) { const d = new Date(`${stamp}T12:00:00`); d.setDate(d.getDate()+n); return localDate(d); }
function monday(stamp) { const d = new Date(`${stamp}T12:00:00`); return offsetDay(stamp, -((d.getDay()+6)%7)); }
const labelDate = stamp => new Date(`${stamp}T12:00:00`).toLocaleDateString('de-DE', {weekday:'long',day:'2-digit',month:'2-digit'});
const pretty = n => new Intl.NumberFormat('de-DE',{maximumFractionDigits:3}).format(n);

async function prepareRecipeImage(file, maxMB = 20) {
  if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)) {
    throw new Error('Bitte ein JPEG-, PNG-, WebP- oder GIF-Bild auswählen.');
  }
  if (!file.size || file.size > maxMB * 1024 * 1024) throw new Error('Das Bild darf höchstens ' + maxMB + ' MB groß sein.');
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  const matches = {
    'image/jpeg': bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
    'image/png': bytes[0] === 137 && ascii(1, 8) === 'PNG\r\n\x1a\n',
    'image/webp': ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP',
    'image/gif': ['GIF87a','GIF89a'].includes(ascii(0, 6)),
  };
  if (!matches[file.type]) throw new Error('Dateiinhalt passt nicht zum Bildformat.');
  const source = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve,reject)=>{
      const img = new Image();
      img.onload=()=>resolve(img);
      img.onerror=()=>reject(new Error('Das Bild konnte nicht geöffnet werden. Bitte ein anderes Bild auswählen.'));
      img.src=source;
    });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 50000000) {
      throw new Error('Die Bildauflösung ist zu groß. Bitte ein kleineres Bild auswählen.');
    }
    const scale = Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
    canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    const context=canvas.getContext('2d');
    if (!context) throw new Error('Dieser Browser kann das Bild nicht vorbereiten.');
    context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(image,0,0,canvas.width,canvas.height);
    return await new Promise((resolve,reject)=>canvas.toBlob(blob=>{
      if(blob && blob.type==='image/jpeg' && blob.size < 9*1024*1024) resolve(blob);
      else reject(new Error('Das Bild konnte nicht verkleinert werden. Bitte ein anderes Bild auswählen.'));
    },'image/jpeg',0.85));
  } finally { URL.revokeObjectURL(source); }
}

class EssensplanCard extends HTMLElement {
  constructor() {
    super(); this.attachShadow({mode:'open'});
    this._urlChanged = () => this.render();
  }
  setConfig(config) {
    const modes=['today','week','recipes','detail','shopping'];
    const localPath=path=>typeof path==='string' && /^\/(?![\/\\])/.test(path) && !/[\\\r\n\t]/.test(path);
    if (!modes.includes(config.mode || 'today')) throw new Error('mode: today, week, recipes, detail oder shopping');
    for (const key of ['detail_path','week_path']) {
      if (config[key] && !localPath(config[key])) throw new Error(`${key} muss ein lokaler Dashboard-Pfad sein`);
    }
    if (config.view_paths != null) {
      if (typeof config.view_paths!=='object' || Array.isArray(config.view_paths) ||
          Object.entries(config.view_paths).some(([mode,path])=>!modes.includes(mode)||!localPath(path))) {
        throw new Error('view_paths muss Essensplan-Ansichten auf lokale Dashboard-Pfade abbilden.');
      }
    }
    if (config.image_max_mb !== undefined && (!Number.isInteger(config.image_max_mb) || config.image_max_mb < 1 || config.image_max_mb > 20)) throw new Error('image_max_mb: 1–20');
    this.config = {mode:'today', ...config};
    this._mode = this._selectedDate = this._selectedSlot = this._backMode = undefined;
    if (this._hass) this.load();
  }
  set hass(hass) {
    this._hass = hass;
    const sensor = Object.values(hass.states).find(s => s.attributes.essensplan === true);
    const token = sensor?.last_updated;
    if (!this.data || token !== this._token) { this._token = token; this.load(); }
  }
  connectedCallback() {
    window.addEventListener('popstate', this._urlChanged);
    window.addEventListener('location-changed', this._urlChanged);
    this._interval = window.setInterval(() => this.load(), 60000);
    if (this._hass) this.load();
  }
  disconnectedCallback() {
    clearInterval(this._interval); clearTimeout(this._hold);
    this.clearImagePreview();
    this.clearOcrPreview();
    this._barcodeStop?.();
    window.removeEventListener('popstate', this._urlChanged);
    window.removeEventListener('location-changed', this._urlChanged);
  }
  getCardSize() { return this.config?.mode === 'today' ? 3 * (this.data ? this.slotCount(this.data.today) : 1) : 8; }
  getGridOptions() { return {columns:12, min_columns:6}; }
  static getStubConfig() { return {mode:'today'}; }
  async load() {
    if (!this._hass || !this.config || this._loading || !this.isConnected) return;
    this._loading = true;
    try {
      this.data = await this._hass.callWS({type:'essensplan/get'});
      this._loadError = '';
      // Preserve an editor and its unsaved text across background refreshes.
      if (!this.shadowRoot.querySelector('dialog, form') && !this._isInteracting) this.render();
    } catch (err) {
      this._loadError = err.message || String(err);
      if (!this.data) this.render();
    } finally { this._loading = false; }
  }
  async change(operation, payload, revision = this.data.revision) {
    if (this._saving) return;
    this._saving = true;
    try {
      this.data = await this._hass.callWS({type:'essensplan/change', operation, payload, revision});
      this._error = ''; this.render();
      return true;
    } catch (err) {
      this._error = err.message || String(err);
      // Refresh the revision so an intentional retry in a reopened dialog works.
      await this.load();
      const box = this.shadowRoot.querySelector('#error');
      if (box) box.textContent = this._error;
      return false;
    } finally { this._saving = false; }
  }
  backMode() {
    const modes = ['today', 'week', 'recipes', 'shopping'];
    const params = new URLSearchParams(location.search);
    // In-card navigation knows its origin; after a route change the URL carries it.
    if (modes.includes(this._backMode)) return this._backMode;
    if (modes.includes(params.get('from'))) return params.get('from');
    const stamp = this._selectedDate || params.get('meal_date') || this.data?.today;
    return stamp === this.data?.today ? 'today' : 'week';
  }
  navigate(mode, stamp, slot = 0) {
    const current = this._mode || this.config.mode;
    if (mode === 'detail' && current !== 'detail') this._backMode = current;
    if (mode === 'week' && this.data) this.week = monday(stamp || this.data.today);
    const path = this.config.view_paths?.[mode] ||
      (mode === 'detail' ? this.config.detail_path : mode === 'week' ? this.config.week_path : undefined);
    if (path) {
      const url = new URL(path, location.origin);
      if (stamp) url.searchParams.set('meal_date', stamp);
      if (mode === 'detail' && slot) url.searchParams.set('meal_slot', slot);
      if (mode === 'detail' && ['today', 'week', 'recipes', 'shopping'].includes(current)) url.searchParams.set('from', current);
      if (url.pathname+url.search+url.hash === location.pathname+location.search+location.hash) return;
      history.pushState(null, '', url.pathname+url.search+url.hash);
      window.dispatchEvent(new CustomEvent('location-changed',{detail:{replace:false}}));
    } else {
      this._mode = mode; this._selectedDate = stamp; this._selectedSlot = slot; this.render();
    }
  }
  mealsFor(stamp) {
    const meals = this.data.plan[stamp];
    return Array.isArray(meals) ? meals : meals ? [meals] : [];
  }
  slotCount(stamp) { return Math.max(this.data.meals_per_day || 1, this.mealsFor(stamp).length); }
  recipeFor(stamp, slot = 0) {
    const meal = Number.isInteger(slot) && slot >= 0 ? this.mealsFor(stamp)[slot] : null;
    return {meal, recipe:this.data.recipes[meal?.recipe_id]};
  }
  render() {
    if (!this.config) return;
    this.clearImagePreview();
    this.clearOcrPreview();
    this._barcodeStop?.();
    const mode = this._mode || this.config.mode;
    const d = this.data;
    let body = '';
    if (!d) body = `<p>${esc(this._loadError || 'Essensplan wird geladen …')}</p><button data-act="reload">Erneut laden</button>`;
    else {
      const routeDate = new URLSearchParams(location.search).get('meal_date');
      const weekDate = mode==='week' && /^\d{4}-\d{2}-\d{2}$/.test(routeDate || '') &&
        Number.isFinite(new Date(`${routeDate}T12:00:00`).getTime()) ? routeDate : d.today;
      this.week ||= monday(weekDate);
      if (mode === 'today') body = this.todayHTML();
      if (mode === 'week') body = this.weekHTML();
      if (mode === 'detail') body = this.detailHTML();
      if (mode === 'recipes') body = this.recipesHTML();
      if (mode === 'shopping') body = this.shoppingHTML();
    }
    const active = d && mode === 'detail' ? this.backMode() : mode;
    const nav = d ? `<nav aria-label="Essensplan">${[['today','🍽️','Heute'],['week','🗓️','Woche'],['recipes','📖','Rezepte'],['shopping','🛒','Einkauf']].map(([key,icon,label])=>
      `<button type="button" data-mode="${key}"${active===key?' aria-current="page"':''}><span class="ico" aria-hidden="true">${icon}</span><span>${label}</span></button>`).join('')}</nav>` : '';
    this.shadowRoot.innerHTML = `<style>
      :host{display:block;color:var(--primary-text-color);font-family:var(--paper-font-body1_-_font-family, sans-serif)}
      *{box-sizing:border-box}ha-card{padding:18px;overflow:hidden}h2{font-size:22px;margin:4px 0 12px}h3{margin:12px 0 8px;font-size:18px}p{line-height:1.5}small,.muted{color:var(--secondary-text-color)}
      button,select,input,textarea{font:inherit;color:var(--primary-text-color);border:1px solid var(--divider-color,#8885);border-radius:10px;background:var(--card-background-color,#fff);padding:10px;min-height:44px}
      button{cursor:pointer}button:hover{border-color:var(--primary-color)}button:focus-visible,input:focus,textarea:focus,select:focus{outline:2px solid var(--primary-color);outline-offset:2px}
      .primary{background:var(--primary-color);color:var(--text-primary-color,#fff);border-color:transparent}.danger{color:var(--error-color,#c33)}
      .row,.actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
      .row{justify-content:space-between}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:12px}
      .recipe{border:1px solid var(--divider-color,#8883);border-radius:16px;padding:12px}.recipe img,.hero{width:100%;height:150px;object-fit:cover;border-radius:12px}.emoji{font-size:38px;line-height:1.4}
      .tile{width:100%;text-align:left;touch-action:pan-y;padding:18px;border-radius:16px;background:var(--secondary-background-color,#8881)}.tile strong{display:block;font-size:24px;margin:8px 0}.tile small{display:block}
      .meals{display:grid;gap:10px}.tile .cta{display:block;margin-top:10px;font-weight:650;color:var(--primary-color)}
      .day{padding:14px 0;border-bottom:1px solid var(--divider-color,#8883)}.day.today{border-left:3px solid var(--primary-color);padding-left:10px}
      .day-head{display:flex;align-items:center;gap:8px}.badge{font-size:12px;padding:2px 10px;border-radius:999px;background:var(--primary-color);color:var(--text-primary-color,#fff)}
      .slot{display:flex;align-items:stretch;gap:8px;margin:8px 0 0}
      .slot button.slot-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;text-align:left;min-height:58px;padding:12px 16px;border-radius:18px}
      .slot-main strong{font-size:17px;overflow-wrap:anywhere}.slot-main small{overflow-wrap:anywhere}
      .slot.empty button.slot-main{border-style:dashed;color:var(--secondary-text-color)}.slot.empty .slot-main strong{font-weight:500}
      .slot button.slot-check{flex:0 0 56px;width:56px;padding:0;font-size:24px;border-radius:18px}
      .slot button.slot-check[aria-pressed=true]{background:var(--success-color,#2e7d32);border-color:transparent;color:#fff}
      .slot.cooked .slot-main strong{color:var(--secondary-text-color)}
      .back-row{margin-bottom:12px}
      label{display:block;margin:12px 0 5px}input:not([type=checkbox]),textarea{width:100%}textarea{min-height:115px;resize:vertical}li{margin-bottom:12px;line-height:1.5}#error{color:var(--error-color,#c33);white-space:pre-wrap}#error:empty{display:none}
      .check{display:flex;align-items:center;gap:12px;margin:0;padding:10px 0;border-bottom:1px solid var(--divider-color,#8883)}.check input{width:24px;height:24px}.check.done span{text-decoration:line-through;color:var(--secondary-text-color)}
            .recipe-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(230px,100%),1fr));gap:16px;margin-top:14px}
      .recipe-card{min-width:0;border-radius:18px;overflow:hidden;background:var(--card-background-color,#fff);box-shadow:0 3px 14px #0002;border:1px solid var(--divider-color,#8884)}
      .recipe-media{position:relative;aspect-ratio:4/3;background:#e5ab75;overflow:hidden}.recipe-media img{width:100%;height:100%;object-fit:cover;display:block}
      .recipe-info{padding:12px 14px;overflow-wrap:anywhere}.recipe-info h3{margin:0 0 5px}.recipe-info .actions{margin-top:10px}
      .bubbles{position:absolute;right:12px;bottom:12px;display:flex;gap:8px}.bubble{width:46px;height:46px;border-radius:50%;display:grid;place-items:center;padding:0;background:var(--card-background-color,#fff);box-shadow:0 2px 8px #0005}.bubble svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8}
      .barcode-video{width:100%;max-height:240px;object-fit:contain;background:#111}
      dialog.wide{width:min(760px,calc(100% - 24px))}
      button:disabled{opacity:.5;cursor:default}
      .ing-summary{font-weight:600;margin:8px 0}
      .ing-list,.amount-table{display:grid;gap:8px;margin:12px 0}
      .ing-row,.amount-row{border:1px solid var(--divider-color,#8884);border-radius:16px;padding:10px 12px;min-width:0;background:var(--card-background-color,#fff)}
      .ing-row.changed{border-color:var(--primary-color)}
      .ing-head{display:grid;grid-template-columns:minmax(150px,1fr) minmax(0,1.5fr) auto;gap:10px;align-items:center}
      .ing-head .actions{justify-content:flex-end;flex-wrap:nowrap}
      .ing-name,.ing-state{min-width:0;overflow-wrap:anywhere}.ing-name small,.ing-state small{display:block}
      .ing-head .actions button{min-height:40px;padding:6px 14px}
      .ok{color:var(--success-color,#2e7d32);font-weight:600}.warn{color:var(--warning-color,#b26a00);font-weight:600}
      .amount-row{display:grid;grid-template-columns:88px 96px minmax(0,1fr) auto;gap:8px;align-items:center}
      .amount-row input[data-qty]{width:100%;text-align:right}.amount-row select{width:100%}
      .amount-name{min-width:0;overflow-wrap:anywhere}.amount-state{font-size:13px}
      .amount-row > button{min-height:40px;padding:6px 14px}
      .amount-row .ing-panel,.amount-row .amount-reset{grid-column:1 / -1}
      .ing-panel{margin-top:10px;padding-top:10px;border-top:1px dashed var(--divider-color,#8885)}
      .ing-panel fieldset{border:1px solid var(--divider-color,#8884);border-radius:12px;margin:10px 0;min-width:0}
      .choice-list{display:grid;gap:2px;margin:8px 0;max-height:260px;overflow:auto}
      .check-line{display:flex;align-items:center;gap:10px;margin:6px 0}.check-line input{width:22px;height:22px;flex:0 0 auto;min-height:0}
      .choice{padding:6px 8px;border-radius:10px}.choice:has(input:checked){background:var(--secondary-background-color,#8882)}
      .search-line{display:flex;flex-wrap:wrap;gap:8px;align-items:end}.search-line label{flex:1 1 220px;margin:6px 0 0}
      .choice>span{display:flex;flex-direction:column;min-width:0}.choice small{color:var(--secondary-text-color);font-size:12px}
      .choice-heading{margin:8px 8px 2px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--secondary-text-color)}
      .choice-list{max-height:none;overflow:visible}.scan-box{display:grid;gap:8px;margin:8px 0}
      .weight-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0 10px}
      .weight-grid label{margin:8px 0 0;font-size:13px}
      details summary{cursor:pointer;margin:8px 0;font-weight:600}
      button.link{border:0;background:none;padding:0 4px;min-height:0;color:var(--primary-color);text-decoration:underline;box-shadow:none;font-size:inherit}
      .sticky-actions{position:sticky;bottom:-16px;background:var(--card-background-color,#fff);padding:10px 0;border-top:1px solid var(--divider-color,#8883)}
      @media(max-width:560px){.ing-head{grid-template-columns:minmax(0,1fr)}.ing-head .actions{flex-wrap:wrap}
        .amount-row{grid-template-columns:76px 88px minmax(0,1fr)}.amount-row .amount-name{grid-column:1 / -1;grid-row:1}
        .amount-row > button{grid-column:3}}
      .ocr-columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:12px;align-items:start}
      .ocr-columns img{display:block;max-width:100%;max-height:380px;object-fit:contain;border-radius:8px}.ocr-columns textarea{min-height:220px}
      .picker-list{display:grid;gap:8px;margin:12px 0}.picker-list button{text-align:left}
      dialog{box-sizing:border-box;width:min(560px,calc(100% - 24px));max-height:calc(100% - 24px);overflow:auto;border:1px solid var(--divider-color,#8885);border-radius:18px;padding:16px;color:var(--primary-text-color,#222);background:var(--card-background-color,#fff)}dialog::backdrop{background:#0008}dialog select{width:100%}.detail-cover{margin-bottom:12px}
      .image-preview{display:block;width:100%;max-height:220px;object-fit:contain;border-radius:12px;margin:10px 0;background:var(--secondary-background-color,#8881)}[hidden]{display:none!important}
      :host{
        --ep-surface:var(--card-background-color,#fff);
        --ep-text:var(--primary-text-color,#202631);
        --ep-accent:var(--primary-color,#507ca0);
        --ep-edge:var(--divider-color,#80808040);
        --ep-glint:#fff3;
        --ep-shadow:0 8px 24px #0002;
        font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      }
      ha-card{
        color:var(--ep-text);border-radius:26px;border:1px solid var(--ep-edge);
        background:var(--ep-surface);
        background-image:url("/essensplan_static/kitchen-background.svg?v=0.15.0"),
          radial-gradient(ellipse at top left,#d9a47524,transparent 68%);
        background-size:min(100%,640px) auto,100% 360px;
        background-position:top right,top left;background-repeat:no-repeat;
        box-shadow:var(--ep-shadow),inset 0 1px 0 var(--ep-glint);
      }
      h2,h3{letter-spacing:-.025em}
      .recipe-card,.tile,dialog{
        border-radius:22px;background:var(--ep-surface);border:1px solid var(--ep-edge);
        box-shadow:0 6px 20px #0002,inset 0 1px 0 var(--ep-glint);
      }
      .recipe-media::after{
        content:"";position:absolute;inset:0;pointer-events:none;
        background:linear-gradient(155deg,#fff2,transparent 38%,transparent 65%,#0003);
      }
      .bubbles{z-index:1}
      button:not(.tile){border-radius:999px}
      button:not(.primary),select,input,textarea{box-shadow:inset 0 1px 0 var(--ep-glint)}
      .bubble{background:var(--ep-surface);color:var(--ep-text);border:1px solid var(--ep-glint);box-shadow:0 3px 12px #0005,inset 0 1px 0 var(--ep-glint)}
      nav{
        display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;margin:0 0 16px;
        border:1px solid var(--ep-edge);border-radius:22px;padding:5px;
        background:var(--secondary-background-color,var(--ep-surface));
      }
      nav button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;min-height:54px;padding:6px 4px;
        font-size:13px;border-color:transparent;background:transparent}
      nav button .ico{font-size:20px;line-height:1.1}
      nav button[aria-current=page]{background:var(--ep-accent);color:var(--text-primary-color,#fff);font-weight:650}
      dialog{box-shadow:0 16px 54px #0005,inset 0 1px 0 var(--ep-glint)}
      @supports (color:color-mix(in srgb,white,black)){
        ha-card{
          background-image:url("/essensplan_static/kitchen-background.svg?v=0.15.0"),
            radial-gradient(ellipse at 2% 0%,color-mix(in srgb,#e6ad7d 20%,transparent),transparent 63%),
            radial-gradient(ellipse at 96% 16%,color-mix(in srgb,#9baa7f 18%,transparent),transparent 65%),
            radial-gradient(ellipse at 5% 100%,color-mix(in srgb,var(--ep-accent) 12%,transparent),transparent 66%);
          background-size:min(100%,640px) auto,100% 420px,100% 420px,100% 360px;
          background-position:top right,top left,top right,bottom left;
        }
        .recipe-card,.tile,.slot-main{background:color-mix(in srgb,var(--ep-surface) 86%,transparent)}
        .bubble{background:color-mix(in srgb,var(--ep-surface) 91%,transparent)}
        dialog{background:color-mix(in srgb,var(--ep-surface) 97%,transparent)}
      }
      @supports (backdrop-filter:blur(8px)){
        .bubble{backdrop-filter:blur(8px)}
      }
      .ingredients-field{margin:18px 0 0;padding:0;border:0;min-width:0;container-type:inline-size}
      .ingredients-field legend{font-weight:650;padding:0}
      .ingredient-row{
        display:grid;grid-template-columns:minmax(0,2fr) minmax(76px,.65fr) minmax(100px,1fr) 44px;
        align-items:end;gap:8px;margin:8px 0;padding:10px;border:1px solid var(--ep-edge);border-radius:14px;
        background:var(--ep-surface)
      }
      .ingredient-row label{min-width:0;margin:0;font-size:13px}
      .ingredient-row input,.ingredient-row select{display:block;width:100%;min-width:0;margin-top:4px;font-size:16px}
      .ingredient-row button{width:44px;padding:0;font-size:20px;line-height:1}
      @container (max-width:430px){
        .ingredient-row{grid-template-columns:minmax(0,1fr) minmax(0,1.35fr) 44px}
        .ingredient-row .ingredient-name{grid-column:1 / -1}
      }
      @media(max-width:470px){
        .ingredient-row{grid-template-columns:minmax(0,1fr) minmax(0,1.35fr) 44px}
        .ingredient-row .ingredient-name{grid-column:1 / -1}
      }
      @media (prefers-reduced-transparency:reduce), (forced-colors:active){
        ha-card,.recipe-card,.tile,.slot-main,.bubble,dialog{background:var(--ep-surface);backdrop-filter:none}
      }
      .hint{font-size:13px;line-height:1.5}.spacer{margin-top:12px}@media(max-width:450px){ha-card{padding:12px}nav{gap:2px}nav button{font-size:12px}.slot button.slot-main{padding:10px 12px}.slot button.slot-check{flex-basis:50px;width:50px}}
    </style><ha-card>${nav}<div id="error" role="alert">${esc(this._error)}</div>${this._notice?`<p role="status" tabindex="-1">${esc(this._notice)}</p>`:''}${body}</ha-card>`;
    this.bind();
  }
  todayHTML() {
    const stamp = this.data.today, count = this.slotCount(stamp);
    return `<div class="meals">${Array.from({length:count},(_,slot)=>{
      const {meal, recipe} = this.recipeFor(stamp, slot);
      return `<button class="tile" id="${slot ? `today-${slot}` : 'today'}" data-today-slot="${slot}" aria-label="Gericht ${slot+1}: ${esc(recipe?.name || 'Heute noch nichts geplant')}. ${recipe ? 'Tippen für Rezept, gedrückt halten für Wochenplan.' : 'Tippen, um ein Gericht auszuwählen.'}">
      ${recipe?.image ? `<img class="hero" alt="" src="${esc(recipe.image)}">` : '<span class="emoji" aria-hidden="true">🍽️</span>'}
      <small>${esc(this.config.title || 'Heute auf dem Tisch')} · ${esc(labelDate(stamp))}${count>1?` · Gericht ${slot+1}`:''}</small>
      <strong>${esc(recipe?.name || 'Noch nichts geplant')}</strong>${meal ? `<small>${esc(meal.servings)} Portionen${meal.prepared_from?' · '+esc(this.prepLabel(meal.prepared_from)):''}</small>` : ''}<span class="cta">${meal ? 'Rezept öffnen ›' : 'Gericht auswählen ›'}</span></button>`;
    }).join('')}</div>`;
  }

  prepLabel(source) {
    const cooked=this.mealsFor(source.date)[source.slot]?.cooked;
    return (cooked?'Vorbereitet am ':'Geplante Reste · Kochtag ')+labelDate(source.date);
  }
  sparePortions(date,slot,meal) {
    let spare=Number(meal.cook_servings)-Number(meal.servings);
    for (const stamp of Object.keys(this.data.plan)) for (const item of this.mealsFor(stamp)) {
      if (item?.prepared_from?.date===date && item.prepared_from.slot===slot) spare-=Number(item.servings);
    }
    return Number(spare.toFixed(3));
  }
  openRecipePicker(date,slot,trigger,replace=false) {
    const revision=this.data.revision;
    const recent=new Map();
    for (const stamp of Object.keys(this.data.plan).sort()) for (const meal of this.mealsFor(stamp)) {
      if (meal?.cooked) recent.set(meal.recipe_id,stamp);
    }
    const dialog=document.createElement('dialog');
    dialog.setAttribute('aria-labelledby','picker-title');
    dialog.innerHTML=`<h2 id="picker-title">Rezept auswählen</h2><p>${esc(labelDate(date))} · Gericht ${slot+1}</p>
      <label>Rezepte oder Zutaten suchen<input type="search" autofocus></label>
      <label>Rezeptauswahl<select><option value="">Alle Rezepte</option><option value="favorites">Favoriten</option>
      <option value="recent">Zuletzt gekocht</option></select></label>
      <div class="picker-list" aria-live="polite"></div><button type="button" data-close>Abbrechen</button>`;
    const search=dialog.querySelector('input'), filter=dialog.querySelector('select'), list=dialog.querySelector('.picker-list');
    const recipes=Object.values(this.data.recipes);
    const update=()=>{
      const words=search.value.toLocaleLowerCase('de').trim().split(/\s+/);
      const matches=recipes.filter(r=>(filter.value!=='favorites'||r.favorite) &&
        (filter.value!=='recent'||recent.has(r.id)) &&
        words.every(word=>[r.name,...r.ingredients.map(i=>i.name)].join(' ').toLocaleLowerCase('de').includes(word)));
      matches.sort((a,b)=>(filter.value==='recent'?recent.get(b.id).localeCompare(recent.get(a.id)):0)||a.name.localeCompare(b.name,'de'));
      list.innerHTML=matches.length?matches.map(r=>`<button type="button" data-pick="${esc(r.id)}">${esc(r.name)}</button>`).join(''):
        '<p>Keine passenden Rezepte.</p>';
    };
    search.oninput=filter.onchange=update;
    list.onclick=event=>{
      const id=event.target.closest('[data-pick]')?.dataset.pick;
      if (!id) return;
      if (this.data.revision!==revision || (!replace && this.mealsFor(date)[slot])) {
        list.textContent='Der Platz wurde geändert. Öffne die Rezeptwahl erneut.';
        return;
      }
      this.openRecipeDialog(id,trigger,true,{date,slot});
    };
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>{dialog.remove();trigger.focus();});
    this.shadowRoot.append(dialog);
    update();
    dialog.showModal();
  }
  weekHTML() {
    const hasRecipes = Object.keys(this.data.recipes).length > 0;
    return `<div class="row"><h2>Wochenplan</h2><div class="actions"><button type="button" data-shift="-7" aria-label="Vorherige Woche">←</button><button type="button" data-act="this-week">Heute</button><button type="button" data-shift="7" aria-label="Nächste Woche">→</button></div></div>
      <p class="muted">${esc(labelDate(this.week))} – ${esc(labelDate(offsetDay(this.week,6)))}</p>
      ${!hasRecipes ? '<p>Lege zuerst unter „Rezepte“ dein erstes Gericht an.</p>' : ''}
      ${Array.from({length:7},(_,i)=>{const stamp=offsetDay(this.week,i),count=this.slotCount(stamp);
        return `<section class="day ${stamp===this.data.today?'today':''}" data-date="${stamp}"><div class="day-head"><strong>${esc(labelDate(stamp))}</strong>${stamp===this.data.today?'<span class="badge">Heute</span>':''}</div>
        ${Array.from({length:count},(_,slot)=>this.slotHTML(stamp,slot,count)).join('')}</section>`;}).join('')}
      <p class="hint">Tippe auf ein Gericht, um es zu ändern, oder auf einen freien Platz, um ein Rezept zu wählen. Änderungen gelten sofort und stellen die Einkaufsliste auf diese Woche um.</p>
      <div class="actions"><button type="button" data-act="shopping-week">Einkaufsliste für diese Woche anzeigen</button></div>
      <p class="hint">Gerichte pro Tag: ${this.data.meals_per_day || 1}. Änderbar unter Einstellungen → Geräte & Dienste → Essensplan → Konfigurieren (1–6). Bereits belegte zusätzliche Plätze bleiben erhalten.</p>`;
  }
  slotHTML(stamp, slot, count) {
    const {meal, recipe} = this.recipeFor(stamp, slot);
    const label = `Gericht ${slot+1} am ${labelDate(stamp)}`;
    const title = count > 1 ? `<small>Gericht ${slot+1}</small>` : '';
    if (!meal || !recipe) {
      const can = Object.keys(this.data.recipes).length > 0;
      return `<div class="slot empty"><button type="button" class="slot-main" data-slot-open="${stamp}" data-slot="${slot}" aria-label="${esc(label)}: noch offen${can?'. Rezept auswählen':''}"${can?'':' disabled'}>${title}<strong>Noch offen</strong><small>${can?'Tippen, um ein Rezept zu wählen':'Noch keine Rezepte vorhanden'}</small></button></div>`;
    }
    const spare = meal.cook_servings ? this.sparePortions(stamp, slot, meal) : 0;
    const notes = [`${pretty(Number(meal.servings))} Portionen`];
    if (meal.prepared_from) notes.push(this.prepLabel(meal.prepared_from));
    else if (meal.cook_servings) notes.push(`${pretty(Number(meal.cook_servings))} Portionen ${meal.cooked?'gekocht':'zum Kochen geplant'}`);
    if (spare > 0) notes.push(`${pretty(spare)} Portionen noch nicht verplant`);
    const check = meal.cooked ? 'Gekocht · Rückgängig' : 'Als gekocht markieren';
    return `<div class="slot filled${meal.cooked?' cooked':''}"><button type="button" class="slot-main" data-slot-open="${stamp}" data-slot="${slot}" aria-label="${esc(label)}: ${esc(recipe.name)}. Tippen zum Ändern">${title}<strong>${esc(recipe.name)}</strong><small>${esc(notes.join(' · '))}</small></button>${
      !meal.prepared_from && stamp <= this.data.today ? `<button type="button" class="slot-check" data-cooked="${stamp}" data-slot="${slot}" aria-pressed="${Boolean(meal.cooked)}" aria-label="${check}" title="${check}">✓</button>` : ''}</div>`;
  }
  openSlotDialog(date, slot, trigger) {
    const {meal, recipe} = this.recipeFor(date, slot);
    if (!meal || !recipe || this._saving) return;
    const root = this.shadowRoot, revision = this.data.revision;
    const spare = meal.cook_servings ? this.sparePortions(date, slot, meal) : 0;
    const canCook = !meal.prepared_from && date <= this.data.today;
    root.querySelector('dialog')?.remove();
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-labelledby', 'slot-title');
    dialog.innerHTML = `<h2 id="slot-title">${esc(recipe.name)}</h2>
      <p class="muted">${esc(labelDate(date))}${this.slotCount(date)>1?` · Gericht ${slot+1}`:''} · ${esc(pretty(Number(meal.servings)))} Portionen</p>
      <div class="picker-list">
        <button type="button" data-slot-action="view">Rezept ansehen</button>
        <button type="button" data-slot-action="edit">Portionen und Mealprep ändern</button>
        <button type="button" data-slot-action="replace">Anderes Rezept wählen</button>
        ${spare>0?'<button type="button" data-slot-action="leftover">Reste einplanen</button>':''}
        ${canCook?`<button type="button" data-slot-action="cooked">${meal.cooked?'Gekocht · Rückgängig':'Als gekocht markieren'}</button>`:''}
        <button type="button" class="danger" data-slot-action="remove">Aus dem Plan entfernen</button>
      </div><p role="alert" id="slot-error"></p><button type="button" data-close>Schließen</button>`;
    const error = dialog.querySelector('#slot-error');
    // Hand over to the next dialog without the close handler stealing its focus.
    const handOver = next => { dialog.remove(); next(); };
    const apply = async (operation, payload) => {
      if (!(await this.change(operation, payload, revision)) && dialog.isConnected) error.textContent = this._error;
    };
    let armed = false;
    dialog.querySelectorAll('[data-slot-action]').forEach(button => button.onclick = () => {
      switch (button.dataset.slotAction) {
        case 'view': handOver(() => {this._recipeId = null; this.navigate('detail', date, slot);}); break;
        case 'edit': handOver(() => this.openRecipeDialog(meal.recipe_id, trigger, true, {date, slot})); break;
        case 'leftover': handOver(() => this.openRecipeDialog(meal.recipe_id, trigger, true, {date, slot}, true)); break;
        case 'replace': handOver(() => this.openRecipePicker(date, slot, trigger, true)); break;
        case 'cooked': apply('mark_cooked', {date, slot, cooked: !meal.cooked}); break;
        case 'remove':
          if (!armed) {armed = true; button.textContent = 'Wirklich entfernen?'; break;}
          apply('set_meal', {date, slot, recipe_id: null, servings: meal.servings});
          break;
      }
    });
    dialog.querySelector('[data-close]').onclick = () => dialog.close();
    dialog.addEventListener('close', () => {dialog.remove(); if (trigger?.isConnected) trigger.focus();});
    root.append(dialog);
    dialog.showModal();
  }
  detailHTML() {
    const back = '<div class="actions back-row"><button type="button" data-back>← Zurück</button></div>';
    const stamp = this._selectedDate || new URLSearchParams(location.search).get('meal_date') || this.data.today;
    const slot = this._selectedSlot ?? Number(new URLSearchParams(location.search).get('meal_slot') || 0);
    const {meal,recipe} = this.recipeFor(stamp, slot);
    const direct = this._recipeId ? this.data.recipes[this._recipeId] : null;
    const r = direct || recipe;
    if (!r) return `${back}<h2>Noch kein Gericht geplant</h2><p>Wähle im Wochenplan ein Rezept aus.</p>`;
    const servings = direct ? Number(r.servings) : Number(meal.servings);
    const factor = Number(meal?.cook_servings || servings)/Number(r.servings);
    return `${back}${r.image?`<img class="hero" src="${esc(r.image)}" alt="${esc(r.name)}">`:''}<h2>${esc(r.name)}</h2><p class="muted">${pretty(servings)} Portionen${direct?'':` · ${esc(labelDate(stamp))}${this.slotCount(stamp)>1?` · Gericht ${slot+1}`:''}`}</p>
      ${meal?.prepared_from?`<p>${esc(this.prepLabel(meal.prepared_from))}.</p>`:meal?.cook_servings?`<p>Zutaten für insgesamt ${esc(meal.cook_servings)} Kochportionen.</p>`:''}
      <h3>Zutaten</h3><ul>${(r.ingredients.length ? r.ingredients.map(i=>`<li>${i.quantity == null ? esc(i.name) : `${pretty(Number(i.quantity)*factor)} ${esc(i.unit)} ${esc(i.name)}`}</li>`).join('') : '<li>Keine Zutaten eingetragen</li>')}</ul>
      <h3>Zubereitung</h3>${r.steps.length ? '' : '<p>Keine Zubereitung eingetragen.</p>'}<ol>${r.steps.map(s=>`<li>${esc(s).replace(/\n/g,'<br>')}</li>`).join('')}</ol><p class="hint">Mengen sind auf die geplanten Portionen skaliert. Zeit- oder Mengenangaben im Zubereitungstext werden nicht automatisch umgeschrieben.</p>`;
  }
  recipeImage(r) {
    const fallback = '/essensplan_static/recipe-placeholder.svg';
    return `<img data-recipe-image src="${esc(r.image || fallback)}" alt="" loading="lazy" decoding="async">`;
  }
  recipeMeta(r) {
    return `${r.minutes ? `${esc(r.minutes)} Min. · ` : 'Dauer nicht angegeben · '}${esc(r.servings)} Portionen`;
  }
  nutritionHTML(recipe, showTotal = false) {
    if (!this.data.modules?.nutrition) return '';
    const nutrition=this.data.nutrition?.[recipe.id];
    const open=(nutrition?.items || []).filter(item=>!['ok','ignored'].includes(item.status));
    if (!nutrition?.used) return `<p class="hint">Nährwerte noch nicht berechenbar${open.length?` · ${open.length} ${open.length===1?'Zutat':'Zutaten'} offen`:''}.</p>`;
    const format=values=>`${pretty(Math.round(values.kcal))} kcal · ${pretty(Math.round(values.protein))} g Protein · ${pretty(Math.round(values.carbs))} g Kohlenhydrate · ${pretty(Math.round(values.fat))} g Fett`;
    const missing=open.length ? ` · ${open.length} ${open.length===1?'Zutat':'Zutaten'} fehlt` + (open.length===1?'':'en') : '';
    const groups=[['amount','Menge fehlt'],['mapping','Nicht zugeordnet'],['weight','Gewicht fehlt']]
      .map(([status,label])=>[label,open.filter(item=>item.status===status).map(item=>item.name)]).filter(([,names])=>names.length);
    return `<p class="hint"><strong>Pro Portion${missing?' · unvollständig':''}</strong><br>${format(nutrition.portion)}</p>
      ${showTotal?`<p class="hint"><strong>Gesamtgericht${missing?' · unvollständig':''}</strong><br>${format(nutrition.total)}</p>
      ${groups.map(([label,names])=>`<p class="hint">${label}: ${esc(names.join(', '))}</p>`).join('')}`:''}`;
  }
  ingredientKey(name) {
    // Mirrors nutrition.key() in Python: casefold, strip accents, keep a-z/0-9 words.
    return (String(name ?? '').replace(/ß/g,'ss').toLowerCase().normalize('NFKD')
      .replace(/[^\x00-\x7f]/g,'').match(/[a-z0-9]+/g) || []).join(' ');
  }
  ingredientEntry(name) {
    const key=this.ingredientKey(name);
    const generic={el:{grams:'10',source:'generic'},tl:{grams:'4',source:'generic'},prise:{grams:'0.3',source:'generic'},ml:{grams:'1',source:'generic'}};
    return (this.data.ingredient_list || []).find(entry=>entry.key===key) || {key,name,recipes:0,units:[],status:'open',
      ignore:false,nutrition:null,label:'',weights:generic,defaults:generic};
  }
  // The state of one ingredient as the dialogs show it: saved entry plus not yet saved edits.
  ingredientView(entry, staged) {
    const change=staged.get(entry.key);
    if (!change) return entry;
    const weights={...(entry.defaults||{})};
    for (const [unit,grams] of Object.entries(change.raw.weights||{})) weights[unit]={grams,source:'own'};
    return {...entry, nutrition:change.raw.nutrition, label:change.label, ignore:change.raw.ignore,
      status:change.raw.ignore?'ignored':change.raw.nutrition?'mapped':'open', weights};
  }
  ownWeights(view) {
    return Object.fromEntries(Object.entries(view.weights).filter(([,w])=>w.source==='own').map(([unit,w])=>[unit,w.grams]));
  }
  stageSuggestion(staged, entry, view, suggestion) {
    staged.set(entry.key,{raw:{name:entry.name,nutrition:{code:suggestion.code},weights:this.ownWeights(view),ignore:false},
      label:suggestion.name});
  }
  amountStatus(item, view, useList=false) {
    const units={g:1,kg:1000};
    const override=!useList && item.nutrition;
    if (!override && view.ignore) return {status:'ignored',text:'zählt nicht'};
    if (item.quantity===null || item.quantity==='' || item.quantity===undefined) {
      if (override?.grams) return {status:'ok',grams:Number(override.grams)};
      return {status:'amount',text:'Menge fehlt'};
    }
    const quantity=Number(String(item.quantity).replace(',','.'));
    if (!Number.isFinite(quantity) || quantity<=0) return {status:'amount',text:'Menge prüfen'};
    const unit=item.unit || 'stück';
    const density=Number(view.weights.ml?.grams || 1);
    let grams;
    if (units[unit]) grams=quantity*units[unit];
    else if (unit==='ml' || unit==='l') grams=quantity*(unit==='l'?1000:1)*density;
    else if (view.weights[unit]) grams=quantity*Number(view.weights[unit].grams);
    else return {status:'weight',text:`Gewicht pro ${this.unitLabel(unit)} fehlt`};
    if (!override && !view.nutrition) return {status:'mapping',grams,text:'nicht zugeordnet'};
    return {status:'ok',grams};
  }
  unitLabel(unit) {
    return {'':'–',g:'g',kg:'kg',ml:'ml',l:'l','stück':'Stück',el:'EL',tl:'TL',prise:'Prise',bund:'Bund',dose:'Dose'}[unit] ?? unit;
  }
  weightText(view) {
    const parts=Object.entries(view.weights).filter(([unit,w])=>w.source!=='generic' && unit!=='ml' &&
      (view.units.includes(unit) || w.source==='own')).map(([unit,w])=>`1 ${this.unitLabel(unit)} = ${pretty(Number(w.grams))} g`);
    return parts.join(' · ');
  }
  async ingredientSuggestions(names) {
    const result=new Map();
    for (let start=0; start<names.length; start+=100) {
      const chunk=names.slice(start,start+100);
      const lists=await this._hass.callWS({type:'essensplan/nutrition_search',queries:chunk});
      chunk.forEach((name,index)=>result.set(this.ingredientKey(name),lists[index]));
    }
    return result;
  }
  // Editor for one ingredient; used by the ingredient list and the amounts table.
  ingredientPanel(entry, staged, suggestions, onApply, onCancel) {
    const view=this.ingredientView(entry, staged);
    const panel=document.createElement('div');
    panel.className='ing-panel';
    const fields=[['kcal','Energie (kcal)'],['protein','Protein (g)'],['carbs','Kohlenhydrate (g)'],['fat','Fett (g)']];
    const weightUnits=['stück','el','tl','bund','dose','prise'];
    const relevant=weightUnits.filter(unit=>entry.units.includes(unit) || (unit==='stück' && entry.units.includes('')));
    if (entry.units.some(unit=>unit==='ml' || unit==='l')) relevant.push('ml');
    // Only grams in the recipes: no weight needed, the units stay one tap away.
    const others=[...weightUnits,'ml'].filter(unit=>!relevant.includes(unit));
    const own=this.ownWeights(view);
    const weightInput=unit=>{
      const fallback=(entry.defaults||entry.weights)[unit];
      const hint=fallback && fallback.source!=='own' ? `${pretty(Number(fallback.grams))} g (${fallback.source==='default'?'Standard':'allgemein'})` : 'fehlt';
      const label=unit==='ml' ? 'Gramm pro ml (Dichte)' : `Gramm pro ${this.unitLabel(unit)}`;
      return `<label>${label}<input data-weight="${unit}" inputmode="decimal" value="${esc(own[unit] ?? '')}" placeholder="${esc(hint)}"></label>`;
    };
    const group=`choice-${entry.key}`;
    panel.innerHTML=`<label class="check-line"><input type="checkbox" data-ignore ${view.ignore?'checked':''}>
        Zählt nicht für Nährwerte (z. B. Gewürze, Wasser)</label>
      <div data-mapping>
        <div class="search-line"><label>Lebensmittel oder Produkt<input type="search" maxlength="100" value="${esc(entry.name)}"></label>
          <button type="button" class="primary" data-search>Suchen</button>
          <button type="button" data-scan>Scannen</button></div>
        <div class="scan-box" hidden><video class="barcode-video" autoplay playsinline muted></video>
          <button type="button" data-stop>Kamera schließen</button></div>
        <input type="file" accept="image/*" capture="environment" data-photo-input hidden>
        <p class="hint" data-result role="status"></p>
        <div class="choice-list" role="radiogroup" aria-label="Treffer für ${esc(entry.name)}"></div>
        <p class="hint">Gesucht wird im Bundeslebensmittelschlüssel und bei Open Food Facts. An Open Food Facts gehen nur der Suchbegriff oder der Barcode; der Scan selbst läuft auf dem Gerät.</p>
        <fieldset class="weights"><legend>Gewicht pro Einheit</legend>
          <p class="hint">Damit rechnen Mengen wie „2 Stück“ oder „1 EL“. Leer lassen übernimmt den Vorschlag.</p>
          ${relevant.length?`<div class="weight-grid">${relevant.map(weightInput).join('')}</div>`:''}
          <details><summary>${relevant.length?'Weitere Einheiten':'Einheiten'}</summary><div class="weight-grid">${others.map(weightInput).join('')}</div></details>
        </fieldset>
        <details data-more><summary>Weitere Optionen</summary>
          <div class="search-line"><label>Barcode-Nummer (EAN)<input data-barcode inputmode="numeric" maxlength="14"></label>
            <button type="button" data-lookup>Nachschlagen</button></div>
          <label class="check-line"><input type="radio" name="${esc(group)}" value="manual"> Eigene Werte pro 100 g</label>
          <div data-manual class="weight-grid">${fields.map(([k,l])=>`<label>${l}<input name="${k}" inputmode="decimal" value="${esc(view.nutrition?.values?.[k] ?? '')}"></label>`).join('')}</div>
        </details>
      </div>
      <p class="hint" data-panel-error role="alert"></p>
      <div class="actions"><button type="button" class="primary" data-apply>Übernehmen</button><button type="button" data-cancel>Abbrechen</button></div>`;
    const list=panel.querySelector('.choice-list'), feedback=panel.querySelector('[data-result]');
    const ignore=panel.querySelector('[data-ignore]'), mapping=panel.querySelector('[data-mapping]');
    const more=panel.querySelector('[data-more]'), manualRadio=panel.querySelector('[value=manual]');
    const search=panel.querySelector('[type=search]'), searchButton=panel.querySelector('[data-search]');
    const radios=()=>[...panel.querySelectorAll(`input[name="${CSS.escape(group)}"]`)];
    const current=()=>radios().find(radio=>radio.checked)?.value || '';
    const select=value=>{const radio=radios().find(r=>r.value===value); if (radio) radio.checked=true;};
    // Foods (BLS) by code, products by barcode. Product values are fetched when chosen.
    const foods=new Map(), products=new Map(), matches=new Map();
    let foodList=[], productList=[], allFoods=false;
    if (view.nutrition?.code) foods.set(view.nutrition.code,{code:view.nutrition.code,name:view.label||view.nutrition.code});
    if (view.nutrition?.product) {
      const saved=view.nutrition.product;
      products.set(saved.barcode,{barcode:saved.barcode,name:saved.name,saved:true,kcal:view.nutrition.values?.kcal});
      matches.set(saved.barcode,{product:saved,values:view.nutrition.values});
    }
    const choice=(value,name,meta)=>{
      const label=document.createElement('label');
      label.className='check-line choice';
      label.innerHTML=`<input type="radio" name="${esc(group)}" value="${esc(value)}"><span><span>${esc(name)}</span><small>${esc(meta)}</small></span>`;
      return label;
    };
    const heading=text=>{const p=document.createElement('p');p.className='choice-heading';p.textContent=text;return p;};
    const kcal=value=>value===undefined||value===null||value===''?'':`${pretty(Math.round(Number(value)))} kcal/100 g`;
    const productMeta=p=>[p.quantity,kcal(p.kcal)].filter(Boolean).join(' · ');
    const draw=()=>{
      const selected=current();
      const shownFoods=[...new Map([...foodList,...foods.values()].map(f=>[f.code,f])).values()];
      const shownProducts=[...new Map([...[...products.values()].filter(p=>p.saved||p.scanned),...productList].map(p=>[p.barcode,p])).values()];
      const items=[];
      if (shownProducts.some(p=>p.scanned)) {
        items.push(heading('Gescannt'));
        for (const p of shownProducts.filter(p=>p.scanned)) items.push(choice(`p:${p.barcode}`,p.name,productMeta(p)));
      }
      if (shownFoods.length) items.push(heading('Lebensmittel'));
      // With products in the list, the first foods are enough; the rest is one tap away.
      const limit=allFoods || !productList.length ? shownFoods.length : 4;
      const keep=shownFoods.filter((f,index)=>index<limit || f.code===selected);
      for (const f of keep) items.push(choice(f.code,f.name,kcal(f.kcal)));
      if (keep.length<shownFoods.length) {
        const button=document.createElement('button');
        button.type='button'; button.className='link more-foods';
        button.textContent=`${shownFoods.length-keep.length} weitere Lebensmittel anzeigen`;
        button.onclick=()=>{allFoods=true;draw();};
        items.push(button);
      }
      const rest=shownProducts.filter(p=>!p.scanned);
      if (rest.length) items.push(heading('Produkte'));
      for (const p of rest) items.push(choice(`p:${p.barcode}`,p.name,productMeta(p)));
      items.push(choice('','Noch offen lassen',''));
      list.replaceChildren(...items);
      select(selected);
      if (!current()) select(shownFoods[0]?.code ?? '');
    };
    const remember=(barcode,match,extra={})=>{
      matches.set(barcode,match);
      products.set(barcode,{...products.get(barcode),barcode,name:match.product.name,kcal:match.values.kcal,...extra});
      for (const [k] of fields) panel.querySelector(`[name=${k}]`).value=match.values[k];
    };
    foodList=suggestions.get(entry.key) || [];
    draw();
    select(view.nutrition?.product ? `p:${view.nutrition.product.barcode}` : view.nutrition?.code || (view.nutrition?.values ? 'manual' : current()));
    if (view.nutrition?.values && !view.nutrition.product && !view.nutrition.code) more.open=true;
    const display=()=>{mapping.hidden=ignore.checked;};
    ignore.onchange=display; display();
    searchButton.onclick=async()=>{
      const query=search.value.trim();
      if (!query) {feedback.textContent='Gib ein Lebensmittel oder Produkt ein.';search.focus();return;}
      searchButton.disabled=true; feedback.textContent='Suche läuft …';
      const local=this._hass.callWS({type:'essensplan/nutrition_search',queries:[query]});
      const remote=query.length>=2 ? this._hass.callWS({type:'essensplan/product_search',query}) : Promise.resolve([]);
      try {[foodList]=await local;}
      catch(err) {foodList=[];}
      productList=[]; allFoods=false; draw();
      select(foodList[0]?.code ?? '');
      feedback.textContent='Produkte werden gesucht …';
      try {productList=await remote; feedback.textContent='';}
      catch(err) {feedback.textContent=`Produkte: ${err.message || 'Suche fehlgeschlagen.'}`;}
      draw();
      if (!foodList.length && !productList.length) feedback.textContent='Keine Treffer. Versuche einen anderen Begriff, scanne den Barcode oder gib eigene Werte ein.';
      searchButton.disabled=false;
    };
    search.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();searchButton.click();}};
    const lookup=async(barcode,extra={})=>{
      feedback.textContent='Produkt wird nachgeschlagen …';
      try {
        const match=await this._hass.callWS({type:'essensplan/barcode_lookup',barcode});
        remember(match.product.barcode,match,extra);
        draw(); select(`p:${match.product.barcode}`);
        feedback.textContent=`${match.product.name} · Werte pro ${match.product.basis==='100ml'?'100 ml':'100 g'} bitte prüfen.`;
        return match;
      } catch(err) {
        feedback.textContent=`${err.message || 'Produktabruf fehlgeschlagen.'} Du kannst suchen oder unter „Weitere Optionen“ eigene Werte eingeben.`;
        return null;
      }
    };
    // Choosing a product from the search loads its checked values right away.
    list.addEventListener('change',event=>{
      const value=event.target.value;
      if (value.startsWith('p:') && !matches.has(value.slice(2))) lookup(value.slice(2));
    });
    const scanner=()=>import('/essensplan_static/barcode/scanner.mjs?v=0.15.0');
    const scanBox=panel.querySelector('.scan-box'), video=scanBox.querySelector('video'), scan=panel.querySelector('[data-scan]');
    const photo=panel.querySelector('[data-photo-input]');
    const stopCamera=()=>{this._barcodeStop?.();this._barcodeStop=null;};
    const found=code=>{
      if (!panel.isConnected) return;
      stopCamera();
      panel.querySelector('[data-barcode]').value=code;
      lookup(code,{scanned:true});
    };
    let usePhoto=!navigator.mediaDevices?.getUserMedia;
    const openPhoto=()=>{stopCamera();photo.click();};
    scan.onclick=async()=>{
      if (usePhoto) {openPhoto();return;}
      stopCamera();
      const controller=new AbortController();
      let stream;
      this._barcodeStop=()=>{
        controller.abort();
        stream?.getTracks().forEach(track=>track.stop());
        scanBox.hidden=true; scan.disabled=false;
      };
      scan.disabled=true;
      feedback.textContent='Kamera wird geöffnet …';
      try {
        // Ask before loading the decoder so the request starts in the tap handler.
        stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
        if (controller.signal.aborted) {stream.getTracks().forEach(track=>track.stop());return;}
        const decoder=await scanner();
        if (controller.signal.aborted) return;
        scanBox.hidden=false;
        feedback.textContent='Halte den Barcode in die Kamera.';
        await decoder.scanCamera(stream,video,controller.signal,found);
      } catch(err) {
        if (controller.signal.aborted) return;
        stopCamera();
        usePhoto=true;
        feedback.textContent=err.name==='NotAllowedError'
          ? 'Kamerazugriff verweigert. Tippe noch einmal auf „Scannen“, um ein Foto vom Barcode zu machen.'
          : 'Die Live-Kamera ist hier nicht verfügbar (sie braucht HTTPS). Tippe noch einmal auf „Scannen“, um ein Foto vom Barcode zu machen.';
        scan.focus();
      }
    };
    panel.querySelector('[data-stop]').onclick=stopCamera;
    photo.onchange=async()=>{
      const image=photo.files[0];
      photo.value='';
      if (!image) return;
      feedback.textContent='Barcode wird auf dem Gerät gelesen …';
      try {found(await (await scanner()).scanPhoto(image));}
      catch(err) {feedback.textContent=err.message;}
    };
    const barcodeInput=panel.querySelector('[data-barcode]'), lookupButton=panel.querySelector('[data-lookup]');
    lookupButton.onclick=async()=>{lookupButton.disabled=true;await lookup(barcodeInput.value.trim(),{scanned:true});lookupButton.disabled=false;};
    barcodeInput.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();lookupButton.click();}};
    panel.querySelector('[data-cancel]').onclick=()=>{stopCamera();onCancel();};
    panel.querySelector('[data-apply]').onclick=async()=>{
      const error=panel.querySelector('[data-panel-error]');
      error.textContent='';
      const weights={};
      for (const input of panel.querySelectorAll('[data-weight]')) {
        const value=input.value.trim().replace(',','.');
        if (!value) continue;
        if (!(Number(value)>0)) {error.textContent=`Bitte ein Gewicht größer als 0 eingeben (${this.unitLabel(input.dataset.weight)}).`;input.focus();return;}
        weights[input.dataset.weight]=value;
      }
      const picked=current();
      let nutrition=null, label='';
      if (picked.startsWith('p:')) {
        const match=matches.get(picked.slice(2)) || await lookup(picked.slice(2));
        if (!match) {error.textContent='Für dieses Produkt fehlen Nährwerte. Wähle einen anderen Treffer.';return;}
        nutrition={values:match.values,product:match.product}; label=match.product.name;
      } else if (picked==='manual') {
        const values=Object.fromEntries(fields.map(([k])=>[k,panel.querySelector(`[name=${k}]`).value.trim().replace(',','.')]));
        if (Object.values(values).some(v=>v==='' || !Number.isFinite(Number(v)))) {error.textContent='Bitte alle vier Werte pro 100 g eingeben.';more.open=true;return;}
        nutrition={values}; label='Eigene Werte';
      } else if (picked) {
        nutrition={code:picked}; label=foods.get(picked)?.name || foodList.find(f=>f.code===picked)?.name || picked;
      }
      stopCamera();
      onApply({raw:{name:entry.name,nutrition,weights,ignore:ignore.checked},label});
    };
    manualRadio.addEventListener('change',()=>{more.open=true;});
    return panel;
  }
  ingredientDialog(title) {
    const root=this.shadowRoot;
    this._barcodeStop?.();
    root.querySelector('dialog')?.remove();
    const dialog=document.createElement('dialog');
    dialog.className='wide';
    dialog.setAttribute('aria-label',title);
    root.append(dialog);
    return dialog;
  }
  async openIngredients(trigger) {
    if (!this.data.modules?.nutrition || this._saving) return;
    const dialog=this.ingredientDialog('Zutaten & Nährwerte');
    const staged=new Map();
    let suggestions=new Map(), filter='open', query='', openKey=null, focusPanel=false;
    const entries=()=>this.data.ingredient_list || [];
    dialog.innerHTML=`<h2>Zutaten &amp; Nährwerte</h2>
      <p class="hint">Jede Zutat wird einmal zugeordnet und gilt dann in allen Rezepten. Häufige Zutaten stehen oben.</p>
      <p class="ing-summary" data-summary aria-live="polite"></p>
      <div class="row"><label style="flex:1">Zutat suchen<input type="search" data-filter-text placeholder="z. B. Zwiebel"></label>
        <div class="actions" role="group" aria-label="Filter"><button type="button" data-filter="open">Offen</button><button type="button" data-filter="all">Alle</button></div></div>
      <div class="ing-list"></div>
      <p class="hint" role="status" data-status></p>
      <div class="actions sticky-actions"><button type="button" data-bulk>Alle Vorschläge übernehmen</button>
        <button type="button" class="primary" data-save disabled>Speichern</button><button type="button" data-close>Schließen</button></div>
      <p class="hint">Quellen: Bundeslebensmittelschlüssel 4.0 (CC BY 4.0) und Open Food Facts (ODbL).</p>`;
    const list=dialog.querySelector('.ing-list'), status=dialog.querySelector('[data-status]');
    const save=dialog.querySelector('[data-save]'), bulk=dialog.querySelector('[data-bulk]');
    const suggestionFor=view=>view.status==='open' ? (suggestions.get(view.key) || [])[0] : null;
    const rowFor=entry=>{
      const view=this.ingredientView(entry, staged);
      const row=document.createElement('div');
      row.className=`ing-row ${view.status}${staged.has(entry.key)?' changed':''}`;
      row.dataset.key=entry.key;
      const suggestion=suggestionFor(view);
      const weights=this.weightText(view);
      const usage=`${entry.recipes} ${entry.recipes===1?'Rezept':'Rezepte'}${entry.unmeasured?` · ${entry.unmeasured}× ohne Menge`:''}`;
      const state=view.status==='mapped' ? `<span class="ok">✓ ${esc(view.label)}</span>${weights?`<small>${esc(weights)}</small>`:''}`
        : view.status==='ignored' ? '<span class="muted">Zählt nicht</span>'
        : suggestion ? `<span>Vorschlag: <strong>${esc(suggestion.name)}</strong></span>`
        : '<span class="warn">Kein Vorschlag – bitte suchen</span>';
      row.innerHTML=`<div class="ing-head"><div class="ing-name"><strong>${esc(view.name)}</strong><small>${esc(usage)}</small></div>
        <div class="ing-state">${state}</div>
        <div class="actions">${suggestion?`<button type="button" class="primary" data-accept>Übernehmen</button>`:''}
          <button type="button" data-edit aria-expanded="${openKey===entry.key}">${view.status==='open'&&!suggestion?'Zuordnen':'Ändern'}</button></div></div>`;
      row.querySelector('[data-accept]')?.addEventListener('click',()=>{this.stageSuggestion(staged,entry,view,suggestion);draw();});
      row.querySelector('[data-edit]').onclick=()=>{openKey=openKey===entry.key?null:entry.key;focusPanel=Boolean(openKey);draw();};
      if (openKey===entry.key) {
        row.append(this.ingredientPanel(entry, staged, suggestions, change=>{staged.set(entry.key,change);openKey=null;draw();},
          ()=>{openKey=null;draw();}));
      }
      return row;
    };
    const draw=()=>{
      const all=entries().map(entry=>this.ingredientView(entry, staged));
      const mapped=all.filter(v=>v.status==='mapped').length, ignored=all.filter(v=>v.status==='ignored').length;
      const open=all.length-mapped-ignored;
      const uses=all.reduce((sum,v)=>sum+v.recipes,0), covered=all.filter(v=>v.status!=='open').reduce((sum,v)=>sum+v.recipes,0);
      dialog.querySelector('[data-summary]').textContent=`${mapped} von ${all.length} Zutaten zugeordnet · ${ignored} zählen nicht · ${open} offen`+
        (uses?` · deckt ${Math.round(100*covered/uses)} % der Zutaten in euren Rezepten ab`:'');
      for (const button of dialog.querySelectorAll('[data-filter]')) button.setAttribute('aria-pressed',String(button.dataset.filter===filter));
      const text=this.ingredientKey(query);
      const shown=entries().filter(entry=>{
        const view=this.ingredientView(entry, staged);
        return (filter==='all' || view.status==='open' || staged.has(entry.key) || openKey===entry.key) && (!text || entry.key.includes(text));
      });
      list.replaceChildren(...shown.map(rowFor));
      if (!shown.length) list.innerHTML=`<p class="muted">${filter==='open'?'Alles zugeordnet. Unter „Alle“ kannst du Zuordnungen ändern.':'Keine passende Zutat.'}</p>`;
      const pending=shown.filter(entry=>suggestionFor(this.ingredientView(entry, staged)));
      bulk.hidden=!pending.length;
      bulk.textContent=`Alle Vorschläge übernehmen (${pending.length})`;
      bulk.onclick=()=>{
        for (const entry of pending) {
          const view=this.ingredientView(entry, staged);
          this.stageSuggestion(staged, entry, view, suggestionFor(view));
        }
        status.textContent=`${pending.length} Vorschläge übernommen. Prüfe die Liste und speichere.`;
        draw();
      };
      save.disabled=!staged.size || this._saving;
      save.textContent=staged.size?`${staged.size} ${staged.size===1?'Änderung':'Änderungen'} speichern`:'Speichern';
      const focus=focusPanel && openKey && list.querySelector(`[data-key="${CSS.escape(openKey)}"] .ing-panel input[type=search]`);
      if (focus) {focus.focus();focus.scrollIntoView({block:'nearest'});}
      focusPanel=false;
    };
    dialog.querySelector('[data-filter-text]').oninput=event=>{query=event.target.value;draw();};
    for (const button of dialog.querySelectorAll('[data-filter]')) button.onclick=()=>{filter=button.dataset.filter;draw();};
    save.onclick=async()=>{
      save.disabled=true;
      status.textContent='Wird gespeichert …';
      if (await this.change('set_ingredients',{items:[...staged.values()].map(change=>change.raw)})) return;
      status.textContent=this._error;
      save.disabled=false;
    };
    dialog.querySelector('[data-close]').onclick=()=>{
      if (staged.size && !confirm('Nicht gespeicherte Zuordnungen verwerfen?')) return;
      dialog.close();
    };
    dialog.addEventListener('cancel',event=>{if(staged.size && !confirm('Nicht gespeicherte Zuordnungen verwerfen?')) event.preventDefault();});
    dialog.addEventListener('close',()=>{this._barcodeStop?.();dialog.remove();if(trigger?.isConnected)trigger.focus();});
    if (!entries().some(entry=>entry.status==='open')) filter='all';
    draw();
    dialog.showModal();
    status.textContent='Vorschläge werden geladen …';
    try {
      suggestions=await this.ingredientSuggestions(entries().filter(entry=>entry.status==='open').map(entry=>entry.name));
      status.textContent='';
    } catch(err) {status.textContent=err.message || 'Vorschläge konnten nicht geladen werden.';}
    if (dialog.isConnected) draw();
  }
  async openAmounts(id, trigger) {
    if (!this.data.modules?.nutrition || this._saving) return;
    const recipe=this.data.recipes[id], revision=this.data.revision;
    if (!recipe?.ingredients.length) return;
    const dialog=this.ingredientDialog('Mengen & Nährwerte');
    const staged=new Map();
    let suggestions=new Map(), openIndex=null;
    const units=['','g','kg','ml','l','stück','el','tl','prise','bund','dose'];
    const items=recipe.ingredients.map(item=>({...item, useList:false}));
    dialog.innerHTML=`<h2>Mengen &amp; Nährwerte</h2><p><strong>${esc(recipe.name)}</strong> · ${pretty(Number(recipe.servings))} Portionen</p>
      <p class="hint">Trage Mengen ein. Stück, EL und TL werden über das Gewicht der Zutat in Gramm umgerechnet.</p>
      <p class="ing-summary" data-summary aria-live="polite"></p>
      <form><div class="amount-table"></div><p role="status" class="hint" data-status></p>
      <div class="actions sticky-actions"><button type="submit" class="primary">Speichern</button><button type="button" data-close>Abbrechen</button>
        <button type="button" data-all-ingredients>Alle Zutaten …</button></div></form>`;
    const table=dialog.querySelector('.amount-table'), form=dialog.querySelector('form'), status=dialog.querySelector('[data-status]');
    const describe=(item,view,info)=>{
      const grams=info.grams!==undefined?`≈ ${pretty(Math.round(info.grams))} g`:'';
      if (info.status==='ignored') return `<span class="muted">zählt nicht</span>`;
      if (info.status==='ok') {
        const source=item.nutrition && !item.useList ? 'eigene Zuordnung im Rezept' : view.label;
        return `<span class="ok">✓ ${grams}</span> <small>${esc(source)}</small>`;
      }
      if (info.status==='mapping') {
        const suggestion=(suggestions.get(view.key)||[])[0];
        return `${grams?`<small>${grams}</small> `:''}<span class="warn">nicht zugeordnet</span>${suggestion?
          ` <button type="button" class="link" data-accept>Übernehmen: ${esc(suggestion.name)}</button>`:''}`;
      }
      return `<span class="warn">${esc(info.text)}</span>`;
    };
    const draw=()=>{
      let complete=0, ignored=0;
      table.replaceChildren(...items.map((item,index)=>{
        const entry=this.ingredientEntry(item.name), view=this.ingredientView(entry, staged);
        const info=this.amountStatus(item, view, item.useList);
        if (info.status==='ok') complete++;
        if (info.status==='ignored') ignored++;
        const row=document.createElement('div');
        row.className=`amount-row status-${info.status}`;
        row.innerHTML=`<input aria-label="Menge ${esc(item.name)}" data-qty inputmode="decimal" value="${esc(item.quantity==null?'':String(item.quantity).replace('.',','))}" placeholder="Menge">
          <select aria-label="Einheit ${esc(item.name)}" data-unit>${units.map(u=>`<option value="${u}"${(item.unit||'')===u?' selected':''}>${this.unitLabel(u)}</option>`).join('')}</select>
          <div class="amount-name"><strong>${esc(item.name)}</strong><div class="amount-state">${describe(item,view,info)}</div></div>
          <button type="button" data-edit aria-expanded="${openIndex===index}" aria-label="${esc(item.name)} zuordnen">${info.status==='weight'?'Gewicht':'Zuordnen'}</button>`;
        if (item.nutrition && !item.useList) {
          const reset=document.createElement('label');
          reset.className='check-line amount-reset';
          reset.innerHTML='<input type="checkbox"> Zuordnung aus der Zutatenliste verwenden';
          reset.querySelector('input').onchange=()=>{item.useList=true;draw();};
          row.append(reset);
        }
        const qty=row.querySelector('[data-qty]'), unit=row.querySelector('[data-unit]');
        qty.oninput=()=>{
          item.quantity=qty.value.trim()===''?null:qty.value.trim();
          if (item.quantity===null) item.unit='';
          refresh(row,index);
        };
        unit.onchange=()=>{item.unit=unit.value;refresh(row,index);};
        row.querySelector('[data-accept]')?.addEventListener('click',()=>{
          this.stageSuggestion(staged, entry, view, (suggestions.get(view.key)||[])[0]);draw();});
        row.querySelector('[data-edit]').onclick=()=>{openIndex=openIndex===index?null:index;draw();};
        if (openIndex===index) {
          row.append(this.ingredientPanel({...entry, units:[...new Set([...entry.units, item.unit||''])]}, staged, suggestions,
            change=>{staged.set(entry.key,change);openIndex=null;draw();}, ()=>{openIndex=null;draw();}));
        }
        return row;
      }));
      const counted=items.length-ignored;
      dialog.querySelector('[data-summary]').textContent=`${complete} von ${counted} Zutaten vollständig`+(ignored?` · ${ignored} zählen nicht`:'')+
        (staged.size?` · ${staged.size} Zuordnung${staged.size===1?'':'en'} neu`:'');
    };
    // Only the status line changes while typing, so focus stays in the field.
    const refresh=(row,index)=>{
      const item=items[index], entry=this.ingredientEntry(item.name), view=this.ingredientView(entry, staged);
      const info=this.amountStatus(item, view, item.useList);
      row.className=`amount-row status-${info.status}`;
      row.querySelector('[data-unit]').value=item.unit||'';
      row.querySelector('.amount-state').innerHTML=describe(item,view,info);
      row.querySelector('[data-edit]').textContent=info.status==='weight'?'Gewicht':'Zuordnen';
      row.querySelector('[data-accept]')?.addEventListener('click',()=>{
        this.stageSuggestion(staged, entry, view, (suggestions.get(view.key)||[])[0]);draw();});
    };
    form.onsubmit=async event=>{
      event.preventDefault();
      this._barcodeStop?.();
      const bad=items.findIndex(item=>item.quantity!==null && !(Number(String(item.quantity).replace(',','.'))>0));
      if (bad>=0) {status.textContent=`Bitte die Menge bei „${items[bad].name}“ prüfen.`;table.children[bad]?.querySelector('[data-qty]')?.focus();return;}
      const payload={id,items:items.map(item=>({quantity:item.quantity===null?'':String(item.quantity).replace(',','.'),
        unit:item.quantity===null?'':item.unit||'',...(item.useList?{use_list:true}:{})})),
        ingredients:[...staged.values()].map(change=>change.raw)};
      form.querySelector('[type=submit]').disabled=true;
      status.textContent='Wird gespeichert …';
      if (!(await this.change('save_amounts',payload,revision))) {
        status.textContent=this._error;
        form.querySelector('[type=submit]').disabled=false;
      }
    };
    dialog.querySelector('[data-all-ingredients]').onclick=()=>{
      if ((staged.size || items.some((item,i)=>item.quantity!==recipe.ingredients[i].quantity || item.unit!==recipe.ingredients[i].unit))
        && !confirm('Nicht gespeicherte Mengen verwerfen und zur Zutatenliste wechseln?')) return;
      this.openIngredients(trigger);
    };
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>{this._barcodeStop?.();dialog.remove();if(trigger?.isConnected)trigger.focus();});
    draw();
    dialog.showModal();
    const open=[...new Set(items.map(item=>this.ingredientEntry(item.name)).filter(entry=>entry.status==='open').map(entry=>entry.name))];
    if (open.length) {
      try {suggestions=await this.ingredientSuggestions(open);}
      catch(err) {status.textContent=err.message || 'Vorschläge konnten nicht geladen werden.';}
      if (dialog.isConnected && openIndex===null) draw();
    }
  }
  recipesHTML() {
    const calendar = '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m-9 2v7m-3.5-3.5h7"/>';
    const book = '<path d="M12 6v15M3 5c4-1 7 0 9 2 2-2 5-3 9-2v14c-4-1-7 0-9 2-2-2-5-3-9-2z"/>';
    const bubble = (action, id, label, icon) => `<button class="bubble" data-${action}="${esc(id)}" aria-label="${esc(label)}" title="${esc(label)}"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg></button>`;
    return `<div class="row"><h2>Unsere Rezepte</h2><div class="actions">${this.data.modules?.nutrition?'<button data-ingredients>Zutaten &amp; Nährwerte</button>':''}<button class="primary" data-act="new">+ Rezept</button></div></div>
      <div class="row"><label style="flex:1">Rezepte oder Zutaten suchen<input type="search" id="recipe-search" placeholder="z. B. Paprika" value="${esc(this._recipeSearch || '')}"></label>
      <button type="button" id="favorites-only" aria-pressed="${Boolean(this._favoritesOnly)}">${this._favoritesOnly?'★ Nur Favoriten':'☆ Nur Favoriten'}</button></div>
      <p id="recipe-match-count" class="muted" aria-live="polite"></p>
      <div class="recipe-grid">${Object.values(this.data.recipes).map(r=>`<article class="recipe-card" data-recipe-card="${esc(r.id)}">
      <div class="recipe-media">${this.recipeImage(r)}<div class="bubbles">${bubble('schedule',r.id,`${r.name} einplanen`,calendar)}${bubble('recipe',r.id,`Rezeptdetails: ${r.name}`,book)}</div></div>
      <div class="recipe-info"><h3>${esc(r.name)}</h3><small>${this.recipeMeta(r)}</small>${this.nutritionHTML(r)}<div class="actions">${this.data.modules?.nutrition && r.ingredients.length?`<button data-amounts="${esc(r.id)}">Mengen &amp; Nährwerte</button>`: ''}<button data-favorite="${esc(r.id)}" aria-pressed="${Boolean(r.favorite)}">${r.favorite?'★ Favorit':'☆ Favorit'}</button><button data-edit="${esc(r.id)}">Bearbeiten</button><button class="danger" data-delete="${esc(r.id)}">Löschen</button></div></div></article>`).join('')}</div>
      ${Object.keys(this.data.recipes).length?'':'<p>Hier entsteht eure persönliche Rezeptsammlung. Bilder sind optional.</p>'}`;
  }
  openRecipeDialog(id, trigger, schedule = false, editMeal, openLeftover = false) {
    const r = this.data.recipes[id];
    if (!r || this._saving) return;
    const root = this.shadowRoot;
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-labelledby', 'recipe-dialog-title');
    const revision = this.data.revision;
    const previous = root.querySelector('dialog');
    if (previous) previous.remove();
    const existing=editMeal ? this.mealsFor(editMeal.date)[editMeal.slot] : null;
    const current=existing && existing.recipe_id===id ? existing : null;
    dialog.innerHTML = schedule ? `<h2 id="recipe-dialog-title">${esc(r.name)} ${current?'ändern':'einplanen'}</h2><form>
      <label for="plan-date">Datum</label><input required type="date" id="plan-date" value="${esc(editMeal?.date || this.data.today)}" ${editMeal?'readonly':''}>
      <label for="plan-slot">Platz im Tagesplan</label><select id="plan-slot" ${editMeal?'disabled':''}></select>
      <label for="plan-servings">Portionen an diesem Platz</label><input required type="number" min="0.1" max="100" step="0.1" id="plan-servings" value="${esc(current?.servings || r.servings)}">
      <label for="plan-source">Mealprep</label><select id="plan-source"></select>
      <div id="plan-cook-row"><label for="plan-cook">Insgesamt kochen (optional)</label><input type="number" min="0.1" max="100" step="0.1" id="plan-cook" value="${esc(current?.cook_servings ?? '')}" placeholder="Wie geplant">
      <p id="plan-spare" class="hint" aria-live="polite"></p>
      <button type="button" id="plan-add-leftover" hidden>Reste einplanen</button>
      <fieldset id="plan-leftover" hidden><legend>Reste einplanen</legend>
        <label for="leftover-date">Wann esst ihr die Reste?</label><input type="date" id="leftover-date">
        <label for="leftover-slot">Freier Platz im Tagesplan</label><select id="leftover-slot"></select>
        <label for="leftover-servings">Portionen für diesen Termin</label><input type="number" min="0.001" max="100" step="any" id="leftover-servings">
        <button type="button" id="plan-remove-leftover">Termin weglassen</button>
      </fieldset></div>
      <label id="replace-meal" hidden><input type="checkbox"> Belegten Platz ersetzen</label>
      <p role="alert" id="dialog-error"></p><div class="actions"><button type="submit" class="primary">${current?'Speichern':'Einplanen'}</button><button type="button" data-close>Abbrechen</button></div></form>` :
      `<div class="recipe-media detail-cover">${this.recipeImage(r)}</div><h2 id="recipe-dialog-title">${esc(r.name)}</h2><p class="muted">${this.recipeMeta(r)}</p>${this.nutritionHTML(r,true)}
      <h3>Zutaten</h3><ul>${(r.ingredients.length ? r.ingredients.map(i=>`<li>${i.quantity == null ? esc(i.name) : `${pretty(Number(i.quantity))} ${esc(i.unit)} ${esc(i.name)}`}</li>`).join('') : '<li>Keine Zutaten eingetragen</li>')}</ul>
      <h3>Zubereitung</h3>${r.steps.length ? '' : '<p>Keine Zubereitung eingetragen.</p>'}<ol>${r.steps.map(step=>`<li>${esc(step).replace(/\n/g,'<br>')}</li>`).join('')}</ol>
      <div class="actions"><button class="primary" data-plan>Einplanen</button>${this.data.modules?.nutrition && r.ingredients.length?'<button data-amounts-detail>Mengen &amp; Nährwerte</button>':''}<button data-close>Schließen</button></div>`;
    root.append(dialog);
    dialog.addEventListener('close',()=>{dialog.remove();if(trigger?.isConnected) trigger.focus();});
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();
    this.bindRecipeImages(dialog);
    if (!schedule) {
      dialog.querySelector('[data-plan]').onclick=()=>this.openRecipeDialog(id,trigger,true);
      const amounts=dialog.querySelector('[data-amounts-detail]');
      if (amounts) amounts.onclick=()=>this.openAmounts(id,trigger);
    } else {
      const form=dialog.querySelector('form'), date=dialog.querySelector('#plan-date'), slot=dialog.querySelector('#plan-slot');
      const source=dialog.querySelector('#plan-source'), cook=dialog.querySelector('#plan-cook');
      const eat=dialog.querySelector('#plan-servings'), leftover=dialog.querySelector('#plan-leftover');
      const leftoverDate=dialog.querySelector('#leftover-date'), leftoverSlot=dialog.querySelector('#leftover-slot');
      const leftoverServings=dialog.querySelector('#leftover-servings'), addLeftover=dialog.querySelector('#plan-add-leftover');
      const spareText=dialog.querySelector('#plan-spare');
      const replace=dialog.querySelector('#replace-meal'), check=replace.querySelector('input'), error=dialog.querySelector('#dialog-error');
      const planned=Object.keys(this.data.plan).flatMap(d=>this.mealsFor(d).map((m,s)=>({m,d,s})));
      const reserved=(stamp,index)=>planned.filter(({m,d,s})=>!(d===date.value&&s===Number(slot.value)) &&
        m?.prepared_from?.date===stamp && m.prepared_from.slot===index).reduce((sum,{m})=>sum+Number(m.servings),0);
      const updateLeftoverSlots=()=>{
        const selected=leftoverSlot.value;
        const options=Array.from({length:this.data.meals_per_day || 1},(_,i)=>i).filter(i=>
          (leftoverDate.value>date.value || leftoverDate.value===date.value && i>Number(slot.value)) &&
          !this.mealsFor(leftoverDate.value)[i]);
        leftoverSlot.innerHTML=options.length?options.map(i=>`<option value="${i}">Gericht ${i+1}</option>`).join(''):
          '<option value="">Kein freier späterer Platz</option>';
        if (options.some(i=>String(i)===selected)) leftoverSlot.value=selected;
      };
      let addTerm=false, spare=0;
      const updateCook=()=>{
        cook.disabled=Boolean(source.value);
        dialog.querySelector('#plan-cook-row').hidden=cook.disabled;
        if (cook.disabled) addTerm=false;
        spare=Number((Number(cook.value || eat.value)-Number(eat.value)-reserved(date.value,Number(slot.value))).toFixed(3));
        spareText.textContent=spare>0?`${pretty(spare)} Portionen übrig.`:'Koche mehr Portionen, wenn du Reste einplanen möchtest.';
        addLeftover.hidden=cook.disabled || addTerm || spare<=0 || !date.value;
        leftover.hidden=!addTerm;
        for (const control of [leftoverDate,leftoverSlot,leftoverServings]) {
          control.disabled=!addTerm;
          control.required=addTerm;
        }
        leftoverDate.min=date.value;
        leftoverServings.max=String(Math.max(0,spare));
        if(addTerm) updateLeftoverSlots();
      };
      addLeftover.onclick=()=>{
        addTerm=true;
        leftoverDate.value=offsetDay(date.value,1);
        leftoverServings.value=String(spare);
        updateCook();
        leftoverDate.focus();
      };
      dialog.querySelector('#plan-remove-leftover').onclick=()=>{addTerm=false;updateCook();addLeftover.focus();};
      leftoverDate.onchange=updateLeftoverSlots;
      eat.oninput=cook.oninput=updateCook;
      const updateOccupied=()=>{
        replace.hidden=Boolean(editMeal)||!this.mealsFor(date.value)[Number(slot.value)];
        check.required=!replace.hidden;check.checked=false;
        const selected=source.value || (current?.prepared_from ? `${current.prepared_from.date}/${current.prepared_from.slot}` : '');
        const available=[];
        for (const stamp of Object.keys(this.data.plan).sort()) this.mealsFor(stamp).forEach((batch,index)=>{
          if (!batch || batch.recipe_id!==id || !batch.cook_servings || (stamp>date.value || stamp===date.value && index>=Number(slot.value))) return;
          const used=reserved(stamp,index);
          const left=Number(batch.cook_servings)-Number(batch.servings)-used;
          if(left>0.0001) available.push([`${stamp}/${index}`,` ${batch.cooked?'Vorbereitet':'Geplant'}: ${labelDate(stamp)}, Gericht ${index+1} (${pretty(left)} frei)`]);
        });
        source.innerHTML='<option value="">Frisch kochen</option>'+available.map(([value,label])=>`<option value="${esc(value)}">${esc(label)}</option>`).join('');
        if (available.some(([value])=>value===selected)) source.value=selected;
        updateCook();
      };
      const updateSlots=()=>{
        const meals=this.mealsFor(date.value);
        slot.innerHTML=Array.from({length:this.slotCount(date.value)},(_,i)=>`<option value="${i}">Gericht ${i+1}${meals[i]?' · belegt':''}</option>`).join('');
        const free=Array.from(slot.options).find(option=>!meals[Number(option.value)]);
        if(editMeal) slot.value=String(editMeal.slot);
        else if(free) slot.value=free.value;
        updateOccupied();
      };
      date.onchange=updateSlots;slot.onchange=updateOccupied;source.onchange=updateCook;updateSlots();
      form.onsubmit=async event=>{
        event.preventDefault();
        if (this._saving || !form.reportValidity()) return;
        if (this.data.revision !== revision) {
          error.textContent='Der Plan wurde geändert. Öffne den Dialog erneut, um freie Plätze zu prüfen.';return;
        }
        const payload={date:date.value,slot:Number(slot.value),servings:dialog.querySelector('#plan-servings').value,recipe_id:id};
        if (!editMeal && this.mealsFor(payload.date)[payload.slot] && !check.checked) {
          updateOccupied();return;
        }
        const [sourceDate,sourceSlot]=source.value.split('/');
        payload.prepared_from=sourceDate ? {date:sourceDate,slot:Number(sourceSlot)} : null;
        payload.cook_servings=sourceDate ? null : cook.value || null;
        if (addTerm) payload.leftover={date:leftoverDate.value,slot:Number(leftoverSlot.value),servings:leftoverServings.value};
        const submit=form.querySelector('[type=submit]');
        submit.disabled=true;
        this._notice='';
        if (await this.change('set_meal',payload,revision)) {
          this.week=monday(payload.date);
          this._notice=payload.leftover
            ? `${r.name}: Kochtag ${labelDate(payload.date)}, Reste ${labelDate(payload.leftover.date)}.`
            : `${r.name} wurde für ${labelDate(payload.date)} eingeplant.`;
          this.render();
          this.shadowRoot.querySelector('[role=status]')?.focus();
        } else if (dialog.isConnected) {
          error.textContent=this._error;
          submit.disabled=false;
        }
      };
    }
    dialog.showModal();
    if (openLeftover) dialog.querySelector('#plan-add-leftover:not([hidden])')?.click();
  }
  bindRecipeImages(root) {
    root.querySelectorAll('[data-recipe-image]').forEach(img=>{
      const fallback=()=>{img.onerror=null;img.src='/essensplan_static/recipe-placeholder.svg';};
      img.onerror=fallback;
      if(img.complete && !img.naturalWidth) fallback();
    });
  }
  shoppingHTML() {
    const week = this.data.shopping_week || monday(this.data.today);
    return `<h2>Einkaufsliste</h2><p class="muted">${esc(labelDate(week))} – ${esc(labelDate(offsetDay(week,6)))}</p>${this.data.shopping.map(i=>`<div class="row"><label class="check ${i.completed?'done':''}" style="flex:1"><input type="checkbox" data-check="${i.uid}" ${i.completed?'checked':''}><span>${esc(i.summary)}</span></label>${i.amount_key?`<button type="button" data-amount="${esc(i.amount_key)}">${i.amount?'Menge ändern':'Menge ergänzen'}</button>`:''}</div>`).join('') || '<p>Noch keine Zutaten. Plane Gerichte für diese Woche.</p>'}<p class="hint">Ergänzte Mengen gelten nur für diese Einkaufswoche. Geänderte Mengen werden wieder offen.</p>`;
  }
  shoppingAmount(key, trigger) {
    const item=this.data.shopping.find(i=>i.amount_key===key);
    if (!item || this._saving) return;
    const revision=this.data.revision, dialog=document.createElement('dialog');
    dialog.setAttribute('aria-labelledby','amount-title');
    dialog.innerHTML=`<h2 id="amount-title">${esc(item.ingredient)}</h2><form><p class="hint">Nur für diese Einkaufswoche. Leer lassen setzt die Menge zurück.</p>
      <label>Menge<input id="shopping-quantity" inputmode="decimal" value="${esc(item.amount?.quantity ?? '')}"></label>
      <label>Einheit<select id="shopping-unit">${['','g','kg','ml','l','stück','el','tl','prise','bund','dose'].map(u=>`<option value="${u}" ${u===item.amount?.unit?'selected':''}>${u||'Ohne Einheit'}</option>`).join('')}</select></label>
      <p role="alert"></p><div class="actions"><button class="primary" type="submit">Speichern</button><button type="button" data-close>Abbrechen</button></div></form>`;
    this.shadowRoot.append(dialog);
    dialog.onclose=()=>{dialog.remove();trigger?.focus();};
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();
    dialog.querySelector('form').onsubmit=async event=>{
      event.preventDefault();
      if (await this.change('shopping_amount',{key,quantity:dialog.querySelector('#shopping-quantity').value.trim(),
        unit:dialog.querySelector('#shopping-unit').value},revision)) return;
      dialog.querySelector('[role=alert]').textContent=this._error;
    };
    dialog.showModal();
  }
  clearOcrPreview() {
    this._ocrAbort?.abort();
    this._ocrAbort=null;
    for (const url of this._ocrPreviewUrls || []) URL.revokeObjectURL(url);
    this._ocrPreviewUrls=[];
  }
  clearImagePreview() {
    if (this._imagePreviewUrl) URL.revokeObjectURL(this._imagePreviewUrl);
    this._imagePreviewUrl=null;
  }
  async uploadImage(blob) {
    const form = new FormData();
    form.append('file',blob,'rezeptbild.jpg');
    const response = await this._hass.fetchWithAuth('/api/image/upload',{method:'POST',body:form});
    if (response.status === 413) throw new Error('Das Bild ist für den Upload zu groß.');
    if (response.status === 401 || response.status === 403) throw new Error('Der Bildupload ist nicht erlaubt. Bitte erneut in Home Assistant anmelden.');
    if (!response.ok) throw new Error('Das Bild konnte nicht hochgeladen werden. Bitte erneut versuchen.');
    const uploaded=await response.json();
    if (!/^[0-9a-f]{32}$/.test(uploaded.id || '')) throw new Error('Home Assistant hat den Bildupload nicht bestätigt.');
    return `/api/image/serve/${uploaded.id}/original`;
  }
  editor(id) {
    this.clearOcrPreview();
    this.clearImagePreview();
    const r = this.data.recipes[id] || {name:'',servings:4,image:'',ingredients:[],steps:[]};
    this._editId = id || null;
    this._editRevision = this.data.revision;
    this.shadowRoot.querySelector('ha-card').innerHTML = `<h2>${id?'Rezept bearbeiten':'Neues Rezept'}</h2><div id="error" role="alert"></div><form>
      <div class="actions"><button type="button" id="choose-screenshot">Rezept aus Screenshots</button></div>
      <input id="recipe-screenshot" type="file" multiple accept="image/png,image/jpeg,image/webp" aria-label="Bis zu drei Rezept-Screenshots auswählen" hidden>
      <div id="ocr-order" hidden><p class="hint">Sortiere die Bilder in Lesereihenfolge.</p><ol id="ocr-files"></ol>
        <button type="button" id="ocr-read">Screenshots lesen</button><button type="button" id="ocr-clear-files">Auswahl verwerfen</button></div>
      <p class="hint" id="ocr-status" role="status"></p>
      <div id="ocr-review" hidden>
        <div id="ocr-ingredients-panel"><div class="ocr-columns"><div id="ocr-ingredient-images"><img id="ocr-preview" hidden alt="Ausschnitt der Zutatenliste"></div>
          <div><label for="ocr-text">Erkannte Zutaten · eine pro Zeile</label><textarea id="ocr-text"></textarea>
          <ul id="ocr-flags" class="hint" aria-live="polite" hidden></ul><p id="ocr-diff" class="hint"></p></div></div></div>
        <div id="ocr-steps-panel"><div class="ocr-columns"><div id="ocr-step-images"></div>
          <div><label for="ocr-steps">Erkannte Zubereitung · ein Schritt pro Zeile</label><textarea id="ocr-steps"></textarea>
          <p id="ocr-step-hint" class="hint" hidden></p></div></div></div>
        <div class="actions"><button type="button" id="apply-ocr">Neue Zutaten hinzufügen</button>
          <button type="button" id="apply-ocr-steps">Zubereitung ergänzen</button>
          <button type="button" id="apply-ocr-both">Beides übernehmen</button>
          <button type="button" id="cancel-ocr">Vorschau verwerfen</button></div>
        <p class="hint">Vorhandene Zutaten und Zubereitungsschritte bleiben erhalten.</p></div>
      <label for="name">Rezeptname</label><input id="name" required maxlength="200" value="${esc(r.name)}">
      <label for="servings">Portionen im Grundrezept</label><input id="servings" type="number" min="0.1" max="100" step="0.1" required value="${esc(r.servings)}">
      <label for="minutes">Zubereitungsdauer in Minuten (optional)</label><input id="minutes" type="number" min="1" max="1440" step="1" value="${esc(r.minutes ?? '')}">
      <label for="image-file">Rezeptbild (optional)</label><input id="image-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden>
      <img id="image-preview" class="image-preview" alt="Vorschau des Rezeptbilds" ${r.image?`src="${esc(r.image)}"`:'hidden'}>
      <div class="actions"><button type="button" id="choose-image">Bild auswählen</button><button type="button" id="remove-image" ${r.image?'':'hidden'}>Bild entfernen</button></div>
      <p class="hint" id="image-status" role="status">${r.image?'Rezeptbild gespeichert.':'Noch kein Bild ausgewählt.'}</p>
      <fieldset class="ingredients-field"><legend>Zutaten</legend>
      <p class="hint">Menge und Einheit sind optional. Bei Dezimalmengen geht Komma oder Punkt.</p>
      <div id="ingredients"></div><button type="button" id="add-ingredient">+ Zutat hinzufügen</button></fieldset>
      <label for="steps">Zubereitung · ein Schritt pro Zeile</label><textarea id="steps">${esc(r.steps.join('\n'))}</textarea><div class="actions spacer"><button class="primary" type="submit">Rezept speichern</button><button type="button" id="cancel">Abbrechen</button></div></form>`;
    const form=this.shadowRoot.querySelector('form');
    const field=key=>this.shadowRoot.querySelector(`#${key}`);
    let imagePath=r.image, pendingImage=null, preparing=false, saving=false, selection=0;
    const imageStatus=field('image-status');
    const preview=field('image-preview');
    const fileInput=field('image-file');
    const chooseImage=field('choose-image');
    const removeImage=field('remove-image');
    const saveButton=form.querySelector('[type=submit]');
    const ingredients=field('ingredients');
    const addIngredient=field('add-ingredient');
    const units=[['','Ohne Einheit'],['g','g'],['kg','kg'],['ml','ml'],['l','l'],['stück','Stück'],['el','EL'],['tl','TL'],['prise','Prise'],['bund','Bund'],['dose','Dose']];
    const appendIngredient=(item={}, focus=false)=>{
      if (ingredients.childElementCount >= 100) return;
      const row=document.createElement('div');
      row.className='ingredient-row';
      const currentUnit=item.unit === 'stk' ? 'stück' : item.unit || '';
      row.innerHTML=`<label class="ingredient-name">Zutat<input data-name maxlength="200" placeholder="z. B. Paprika" value="${esc(item.name ?? '')}"></label>
        <label>Menge<input data-quantity inputmode="decimal" placeholder="z. B. 2" value="${esc(item.quantity ?? '')}"></label>
        <label>Einheit<select data-unit>${units.map(([value,label])=>`<option value="${value}"${value===currentUnit?' selected':''}>${label}</option>`).join('')}</select></label>
        <button type="button" data-remove aria-label="Zutat entfernen" title="Zutat entfernen">×</button>`;
      const name=row.querySelector('[data-name]');
      row.querySelector('[data-remove]').onclick=()=>{
        const next=row.nextElementSibling || row.previousElementSibling;
        row.remove();
        addIngredient.disabled=false;
        (next?.querySelector('[data-name]') || addIngredient).focus();
      };
      row.onkeydown=event=>{
        if (event.key !== 'Enter' || event.isComposing || !event.target.matches('input')) return;
        event.preventDefault();
        if (name.value.trim()) {
          if (row.nextElementSibling) row.nextElementSibling.querySelector('[data-name]').focus();
          else appendIngredient({},true);
        } else name.focus();
      };
      ingredients.append(row);
      addIngredient.disabled=ingredients.childElementCount >= 100;
      if (focus) name.focus();
    };
    (r.ingredients.length ? r.ingredients : [{}]).forEach(item=>appendIngredient(item));
    addIngredient.onclick=()=>appendIngredient({},true);
    {
      const screenshot=field('recipe-screenshot'), choose=field('choose-screenshot'), status=field('ocr-status');
      const review=field('ocr-review'), raw=field('ocr-text');
      const crop=field('ocr-preview'), flagsList=field('ocr-flags'), stepsDraft=field('ocr-steps');
      const order=field('ocr-order'), fileList=field('ocr-files');
      let ocr, flags=[], files=[];
      const resetReview=()=>{
        review.hidden=true;
        raw.value=stepsDraft.value='';
        flags=[];
        crop.removeAttribute('src');
        crop.hidden=true;
        field('ocr-ingredient-images').replaceChildren(crop);
        field('ocr-step-images').replaceChildren();
        this.clearOcrPreview();
      };
      const ingredientKey=name=>name.normalize('NFKC').toLocaleLowerCase('de').trim().replace(/\s+/g,' ');
      const previewItems=()=>{
        const lines=raw.value.slice(0,16000).split(/\r?\n/).map(line=>line.trim());
        const warnings=[...new Set([...flags.filter(line=>lines.includes(line)),...lines.filter(ocr?.uncertainAmount || (()=>false))])];
        flagsList.replaceChildren(...warnings.map(line=>{const li=document.createElement('li');li.textContent='Bitte prüfen: '+line;return li;}));
        flagsList.hidden=!warnings.length;
        const known=new Set([...ingredients.querySelectorAll('[data-name]')].map(input=>ingredientKey(input.value)));
        const added=[], skipped=[];
        for (const item of ocr?.parseIngredientLines(raw.value.slice(0,16000)) || []) {
          const key=ingredientKey(item.name);
          if (known.has(key)) skipped.push(item.name);
          else {known.add(key);added.push(item);}
        }
        field('ocr-diff').textContent=`${added.length} neu${skipped.length ? ` · übersprungen: ${skipped.join(', ')}` : ''}`;
        return added;
      };
      raw.oninput=previewItems;
      ingredients.addEventListener('input',()=>{if(!review.hidden) previewItems();});
      choose.onclick=()=>screenshot.click();
      const renderOrder=(focusIndex, direction)=>{
        order.hidden=!files.length;
        fileList.replaceChildren(...files.map((file,index)=>{
          const li=document.createElement('li');
          li.textContent=file.name+' ';
          for (const move of [-1,1]) {
            const button=document.createElement('button');
            button.type='button';
            button.textContent=move<0?'↑':'↓';
            button.setAttribute('aria-label',`Bild ${index+1} nach ${move<0?'oben':'unten'}`);
            const target=index+move;
            button.disabled=target<0 || target>=files.length;
            button.onclick=()=>{
              [files[index],files[target]]=[files[target],files[index]];
              renderOrder(target,move);
            };
            li.append(button);
          }
          return li;
        }));
        if (focusIndex!=null) {
          const buttons=[...fileList.children[focusIndex].querySelectorAll('button:not(:disabled)')];
          (buttons[direction>0?buttons.length-1:0] || field('ocr-read')).focus();
        }
      };
      const recognize=async()=>{
        if (!files.length || saving) return;
        const selected=files;
        files=[];
        renderOrder();
        resetReview();
        const controller=new AbortController();
        this._ocrAbort=controller;
        const active=()=>form.isConnected && !controller.signal.aborted;
        choose.disabled=true;
        status.textContent='Screenshots werden lokal gelesen …';
        try {
          ocr=await import('/essensplan_static/recipe-ocr.mjs?v=0.15.0');
          const result=await ocr.recognizeRecipe(selected,(page,progress)=>{
            if (active()) status.textContent=`Bild ${page} von ${selected.length} wird lokal gelesen … ${progress} %`;
          },controller.signal);
          if (!active()) return;
          if (!result.lines.length && !result.steps.length) {
            throw new Error('Keine Zutaten oder Zubereitung erkannt. Wähle möglichst einen Ausschnitt mit der passenden Überschrift.');
          }
          flags=result.uncertain;
          for (const {kind,index,preview} of result.previews) {
            const image=kind==='ingredients' && crop.hidden?crop:document.createElement('img');
            image.alt=`${kind==='ingredients'?'Zutaten':'Zubereitung'} · Bild ${index+1}`;
            const url=URL.createObjectURL(preview);
            this._ocrPreviewUrls.push(url);
            image.src=url;
            image.hidden=false;
            field(kind==='ingredients'?'ocr-ingredient-images':'ocr-step-images').append(image);
          }
          raw.value=result.lines.join('\n');
          stepsDraft.value=result.steps.join('\n');
          field('ocr-ingredients-panel').hidden=field('apply-ocr').hidden=!result.lines.length;
          field('ocr-steps-panel').hidden=field('apply-ocr-steps').hidden=!result.steps.length;
          field('apply-ocr-both').hidden=!(result.lines.length && result.steps.length);
          const hint=field('ocr-step-hint');
          hint.hidden=!result.uncertainSteps.length;
          hint.textContent=result.uncertainSteps.length?`Bitte prüfe diese Textstellen oder Fortsetzungen: ${[...new Set(result.uncertainSteps)].join(' · ')}`:'';
          review.hidden=false;
          previewItems();
          status.textContent=`${result.lines.length} Zutatenzeilen und ${result.steps.length} Schritte erkannt. Prüfe den Text vor dem Übernehmen.`;
        } catch (error) {
          if (active()) status.textContent=error.message || 'Screenshots konnten nicht gelesen werden.';
        } finally { if (active()) choose.disabled=false; }
      };
      screenshot.onchange=()=>{
        const selected=[...screenshot.files];
        screenshot.value='';
        if (!selected.length || saving) return;
        resetReview();
        files=selected.length<=3?selected:[];
        renderOrder();
        if (!files.length) status.textContent='Wähle höchstens drei Screenshots auf einmal.';
        else if (files.length===1) recognize();
        else {status.textContent='';field('ocr-read').focus();}
      };
      field('ocr-read').onclick=recognize;
      field('ocr-clear-files').onclick=()=>{files=[];renderOrder();choose.focus();};
      field('cancel-ocr').onclick=()=>{resetReview();status.textContent='Vorschau verworfen.';choose.focus();};
      const apply=(withIngredients,withSteps)=>{
        if (!ocr || saving) return;
        const editorSteps=field('steps');
        const current=editorSteps.value.split('\n').filter(line=>line.trim());
        const known=new Set(current.map(ingredientKey));
        const newSteps=withSteps?stepsDraft.value.split('\n').map(line=>line.trim()).filter(line=>
          line && !known.has(ingredientKey(line))):[];
        if (current.length+newSteps.length>100 || newSteps.some(step=>step.length>4000)) {
          status.textContent='Kürze die Vorschau. Ein Rezept erlaubt 100 Schritte mit je höchstens 4.000 Zeichen.';
          return;
        }
        const draft=withIngredients?previewItems():[];
        if (!draft.length && !newSteps.length) {
          status.textContent='Keine neuen Zutaten oder Schritte zum Übernehmen.';
          return;
        }
        if (draft.length) for (const row of [...ingredients.children]) {
          if (![...row.querySelectorAll('input,select')].some(el=>el.value.trim())) row.remove();
        }
        const added=draft.slice(0,100-ingredients.childElementCount);
        added.forEach(item=>appendIngredient({...item,name:item.name.slice(0,200)}));
        if (newSteps.length) {
          const separator=editorSteps.value && !editorSteps.value.endsWith('\n')?'\n':'';
          editorSteps.value+=separator+newSteps.join('\n');
        }
        status.textContent=`${added.length} neue Zutaten und ${newSteps.length} Schritte übernommen.${added.length<draft.length?' Höchstens 100 Zutaten passen in ein Rezept.':''}`;
        resetReview();
        if (newSteps.length) editorSteps.focus();
        else ingredients.querySelector('[data-name]')?.focus();
      };
      field('apply-ocr').onclick=()=>apply(true,false);
      field('apply-ocr-steps').onclick=()=>apply(false,true);
      field('apply-ocr-both').onclick=()=>apply(true,true);
    }
    const busy=value=>{chooseImage.disabled=value;removeImage.disabled=value;saveButton.disabled=value;};
    field('cancel').onclick = ()=>this.render();
    chooseImage.onclick=()=>fileInput.click();
    fileInput.onchange=async()=>{
      const file=fileInput.files[0];
      if(!file || saving) return;
      const token=++selection;
      preparing=true;busy(true);field('error').textContent='';imageStatus.textContent='Bild wird vorbereitet …';
      try {
        const blob=await prepareRecipeImage(file, this.config.image_max_mb);
        if(!form.isConnected || token!==selection) return;
        this.clearImagePreview();pendingImage=blob;
        this._imagePreviewUrl=URL.createObjectURL(blob);
        preview.src=this._imagePreviewUrl;preview.hidden=false;removeImage.hidden=false;
        imageStatus.textContent='Bild ausgewählt · wird mit dem Rezept gespeichert.';
      } catch(err) {
        if(form.isConnected && token===selection) {field('error').textContent=err.message || String(err);imageStatus.textContent='Bitte ein anderes Bild auswählen.';}
      } finally {
        if(form.isConnected && token===selection) {preparing=false;busy(false);fileInput.value='';}
      }
    };
    removeImage.onclick=()=>{
      ++selection;pendingImage=null;imagePath='';this.clearImagePreview();
      preview.removeAttribute('src');preview.hidden=true;removeImage.hidden=true;
      imageStatus.textContent='Kein Bild ausgewählt. Änderung mit dem Rezept speichern.';
    };
    form.onsubmit = async e => {
      e.preventDefault();
      if(preparing || saving || this._saving) return;
      const value = key=>field(key).value;
      const items=[];
      for (const row of ingredients.children) {
        const name=row.querySelector('[data-name]'), quantity=row.querySelector('[data-quantity]'), unit=row.querySelector('[data-unit]');
        const item={name:name.value.trim(),quantity:quantity.value.trim(),unit:unit.value};
        if (!item.name && !item.quantity && !item.unit) continue;
        if (!item.name || (!item.quantity && item.unit)) {
          field('error').textContent=!item.name?'Bitte gib der Zutat einen Namen.':'Bitte gib eine Menge an oder wähle „Ohne Einheit“.';
          (item.name ? quantity : name).focus();
          return;
        }
        items.push(item);
      }
      const payload = {name:value('name'),servings:value('servings'),minutes:value('minutes') ? Number(value('minutes')) : null,image:imagePath,
        ingredients:items,
        steps:value('steps').split('\n').filter(s=>s.trim())};
      if (this._editId) payload.id=this._editId;
      saving=true;busy(true);field('cancel').disabled=true;
      form.querySelectorAll('input,textarea,select,[data-remove],#add-ingredient').forEach(input=>{input.disabled=true;});
      try {
        if(pendingImage) {
          imageStatus.textContent='Bild wird hochgeladen …';
          imagePath=await this.uploadImage(pendingImage);pendingImage=null;payload.image=imagePath;
          imageStatus.textContent='Bild hochgeladen · Rezept wird gespeichert …';
        }
        if(!await this.change('save_recipe',payload,this._editRevision) && form.isConnected) {
          imageStatus.textContent='Rezept noch nicht gespeichert. Deine Eingaben bleiben erhalten.';
        }
      } catch(err) {if(form.isConnected) {
        field('error').textContent=err.message || String(err);
        imageStatus.textContent='Bild noch nicht gespeichert. Du kannst es erneut versuchen.';
      }}
      finally {
        saving=false;
        if(form.isConnected) {
          busy(false);field('cancel').disabled=false;
          form.querySelectorAll('input,textarea,select,[data-remove]').forEach(input=>{input.disabled=false;});
          addIngredient.disabled=ingredients.childElementCount >= 100;
        }
      }
    };
  }
  bind() {
    const root=this.shadowRoot;
    const search=root.querySelector('#recipe-search'), favorites=root.querySelector('#favorites-only');
    if (search && favorites) {
      const normalized=value=>value.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('de');
      const update=()=>{
        const words=normalized(search.value).trim().split(/\s+/).filter(Boolean);
        let found=0;
        root.querySelectorAll('[data-recipe-card]').forEach(card=>{
          const r=this.data.recipes[card.dataset.recipeCard];
          const haystack=normalized([r.name,...r.ingredients.map(i=>i.name)].join(' '));
          card.hidden=(this._favoritesOnly&&!r.favorite)||!words.every(word=>haystack.includes(word));
          if (!card.hidden) found++;
        });
        root.querySelector('#recipe-match-count').textContent=found?`${found} Rezepte`:'Keine passenden Rezepte';
      };
      search.oninput=()=>{this._recipeSearch=search.value;update();};
      favorites.onclick=()=>{
        this._favoritesOnly=!this._favoritesOnly;
        favorites.setAttribute('aria-pressed',String(this._favoritesOnly));
        favorites.textContent=this._favoritesOnly?'★ Nur Favoriten':'☆ Nur Favoriten';
        update();
      };
      update();
    }
    root.querySelectorAll('[data-favorite]').forEach(el=>el.onclick=()=>{
      const id=el.dataset.favorite;this.change('favorite',{id,favorite:!this.data.recipes[id].favorite});
    });
    root.querySelectorAll('[data-amount]').forEach(el=>el.onclick=()=>this.shoppingAmount(el.dataset.amount,el));
    root.querySelectorAll('[data-slot-open]').forEach(el=>el.onclick=()=>{
      const date=el.dataset.slotOpen,slot=Number(el.dataset.slot);
      if (this.mealsFor(date)[slot]) this.openSlotDialog(date,slot,el); else this.openRecipePicker(date,slot,el);
    });
    root.querySelectorAll('[data-cooked]').forEach(el=>el.onclick=()=>{
      this.change('mark_cooked',{date:el.dataset.cooked,slot:Number(el.dataset.slot),cooked:el.getAttribute('aria-pressed')!=='true'});
    });
    root.querySelectorAll('[data-back]').forEach(el=>el.onclick=()=>{this._recipeId=null;this.navigate(this.backMode());});
    root.querySelectorAll('[data-mode]').forEach(el=>el.onclick=()=>{this._recipeId=null;this.navigate(el.dataset.mode);});
    root.querySelectorAll('[data-shift]').forEach(el=>el.onclick=()=>{this.week=offsetDay(this.week,Number(el.dataset.shift));this.render();});
    root.querySelectorAll('[data-detail]').forEach(el=>el.onclick=()=>{this._recipeId=null;this.navigate('detail',el.dataset.detail,Number(el.dataset.slot || 0));});
    this.bindRecipeImages(root);
    root.querySelectorAll('[data-recipe]').forEach(el=>el.onclick=()=>this.openRecipeDialog(el.dataset.recipe,el));
    root.querySelectorAll('[data-amounts]').forEach(el=>el.onclick=()=>this.openAmounts(el.dataset.amounts,el));
    root.querySelectorAll('[data-ingredients]').forEach(el=>el.onclick=()=>this.openIngredients(el));
    root.querySelectorAll('[data-schedule]').forEach(el=>el.onclick=()=>this.openRecipeDialog(el.dataset.schedule,el,true));
    root.querySelectorAll('[data-edit]').forEach(el=>el.onclick=()=>this.editor(el.dataset.edit));
    root.querySelectorAll('[data-delete]').forEach(el=>el.onclick=()=>{if(window.confirm('Dieses Rezept löschen?'))this.change('delete_recipe',{id:el.dataset.delete});});
    root.querySelectorAll('[data-check]').forEach(el=>el.onchange=()=>this.change('complete',{uid:el.dataset.check,completed:el.checked}));
    root.querySelectorAll('[data-act]').forEach(el=>el.onclick=async()=>{
      switch(el.dataset.act) {
        case 'reload': await this.load(); break;
        case 'week': this.navigate('week'); break;
        case 'new': this.editor(); break;
        case 'this-week': this.week=monday(this.data.today);this.render();break;
        case 'shopping-week': if(await this.change('shopping_week',{date:this.week}))this.navigate('shopping');break;
      }
    });
    // Don't replace a focused week selector or portion input on background updates.
    root.querySelectorAll('select,input').forEach(el=>{
      el.onfocus=()=>{this._isInteracting=true;};el.onblur=()=>{this._isInteracting=false;};
    });
    root.querySelectorAll('[data-today-slot]').forEach(tile=>{
      const slot=Number(tile.dataset.todaySlot);
      let held=false, start;
      const cancel=()=>{clearTimeout(this._hold);};
      tile.onpointerdown=e=>{
        if(e.button!==0)return;
        held=false;start={x:e.clientX,y:e.clientY};
        this._hold=setTimeout(()=>{held=true;this.navigate('week');},600);
      };
      tile.onpointermove=e=>{if(start&&Math.hypot(e.clientX-start.x,e.clientY-start.y)>12){cancel();held=true;}};
      tile.onpointerup=cancel;tile.onpointercancel=()=>{cancel();held=true;};tile.onpointerleave=cancel;
      tile.oncontextmenu=e=>e.preventDefault();
      tile.onclick=()=>{
        cancel();
        if(!held){
          this._recipeId=null;
          if(this.recipeFor(this.data.today,slot).recipe) this.navigate('detail',this.data.today,slot);
          else if(Object.keys(this.data.recipes).length) this.openRecipePicker(this.data.today,slot,tile);
          else this.navigate('recipes');
        }
        held=false;
      };
    });
  }
}
if(!customElements.get('essensplan-card')) customElements.define('essensplan-card',EssensplanCard);
window.customCards=window.customCards||[];
if (!window.customCards.some(card=>card.type==='essensplan-card')) {
  window.customCards.push({type:'essensplan-card',name:'Essensplan',description:'Tagesgericht, Wochenplan, Rezepte und Einkaufsliste',preview:false});
}
