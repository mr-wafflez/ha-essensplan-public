/* Essensplan 0.7.2 – bundled with the integration; no CDN or build step. */
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
    this._mode = this._selectedDate = this._selectedSlot = undefined;
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
      if (!this.shadowRoot.querySelector('dialog, form:not([data-meal-slot])') && !this._isInteracting) this.render();
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
      if (operation === 'set_meal') {
        delete this._mealDrafts?.[`${payload.date}/${payload.slot || 0}`];
        for (const draft of Object.values(this._mealDrafts || {})) {
          if (draft.revision === revision) draft.revision = this.data.revision;
        }
      }
      this._error = ''; this.render();
      return true;
    } catch (err) {
      this._error = err.message || String(err);
      // Keep the draft on conflict. Refresh the revision for an intentional retry.
      await this.load();
      const box = this.shadowRoot.querySelector('#error');
      if (box) box.textContent = this._error;
      return false;
    } finally { this._saving = false; }
  }
  navigate(mode, stamp, slot = 0) {
    if (mode === 'week' && this.data) this.week = monday(stamp || this.data.today);
    const path = this.config.view_paths?.[mode] ||
      (mode === 'detail' ? this.config.detail_path : mode === 'week' ? this.config.week_path : undefined);
    if (path) {
      const url = new URL(path, location.origin);
      if (stamp) url.searchParams.set('meal_date', stamp);
      if (mode === 'detail' && slot) url.searchParams.set('meal_slot', slot);
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
    const nav = d && mode !== 'today' ? `<nav aria-label="Essensplan">${[['today','Heute'],['week','Wochenplan'],['recipes','Rezepte'],['shopping','Einkauf']].map(([key,label])=>
      `<button data-mode="${key}"${mode===key?' aria-current="page"':''}>${label}</button>`).join('')}</nav>` : '';
    this.shadowRoot.innerHTML = `<style>
      :host{display:block;color:var(--primary-text-color);font-family:var(--paper-font-body1_-_font-family, sans-serif)}
      *{box-sizing:border-box}ha-card{padding:18px;overflow:hidden}h2{font-size:22px;margin:4px 0 12px}h3{margin:12px 0 8px;font-size:18px}p{line-height:1.5}small,.muted{color:var(--secondary-text-color)}
      button,select,input,textarea{font:inherit;color:var(--primary-text-color);border:1px solid var(--divider-color,#8885);border-radius:10px;background:var(--card-background-color,#fff);padding:10px;min-height:44px}
      button{cursor:pointer}button:hover{border-color:var(--primary-color)}button:focus-visible,input:focus,textarea:focus,select:focus{outline:2px solid var(--primary-color);outline-offset:2px}
      .primary{background:var(--primary-color);color:var(--text-primary-color,#fff);border-color:transparent}.danger{color:var(--error-color,#c33)}
      nav,.row,.actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}nav{margin-top:20px;padding-top:12px;border-top:1px solid var(--divider-color,#8883)}nav button{flex:1;font-size:13px;padding:8px}
      .row{justify-content:space-between}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:12px}
      .recipe{border:1px solid var(--divider-color,#8883);border-radius:16px;padding:12px}.recipe img,.hero{width:100%;height:150px;object-fit:cover;border-radius:12px}.emoji{font-size:38px;line-height:1.4}
      .tile{width:100%;text-align:left;touch-action:pan-y;padding:18px;border-radius:16px;background:var(--secondary-background-color,#8881)}.tile strong{display:block;font-size:24px;margin:8px 0}.tile small{display:block}
      .meals{display:grid;gap:10px}.day form{margin:10px 0 0;padding:10px;border:1px solid var(--divider-color,#8883);border-radius:12px;min-width:0}.day form .muted{font-size:13px}.day select{max-width:100%}
      .day{padding:14px 0;border-bottom:1px solid var(--divider-color,#8883)}.day select{flex:1;min-width:130px}.day input[type=number]{width:90px;flex:0 0 90px}.day .row{margin-top:8px}.day.today{border-left:3px solid var(--primary-color);padding-left:10px}
      label{display:block;margin:12px 0 5px}input:not([type=checkbox]),textarea{width:100%}textarea{min-height:115px;resize:vertical}li{margin-bottom:12px;line-height:1.5}#error{color:var(--error-color,#c33);white-space:pre-wrap}#error:empty{display:none}
      .check{display:flex;align-items:center;gap:12px;margin:0;padding:10px 0;border-bottom:1px solid var(--divider-color,#8883)}.check input{width:24px;height:24px}.check.done span{text-decoration:line-through;color:var(--secondary-text-color)}
            .recipe-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(230px,100%),1fr));gap:16px;margin-top:14px}
      .recipe-card{min-width:0;border-radius:18px;overflow:hidden;background:var(--card-background-color,#fff);box-shadow:0 3px 14px #0002;border:1px solid var(--divider-color,#8884)}
      .recipe-media{position:relative;aspect-ratio:4/3;background:#e5ab75;overflow:hidden}.recipe-media img{width:100%;height:100%;object-fit:cover;display:block}
      .recipe-info{padding:12px 14px;overflow-wrap:anywhere}.recipe-info h3{margin:0 0 5px}.recipe-info .actions{margin-top:10px}
      .bubbles{position:absolute;right:12px;bottom:12px;display:flex;gap:8px}.bubble{width:46px;height:46px;border-radius:50%;display:grid;place-items:center;padding:0;background:var(--card-background-color,#fff);box-shadow:0 2px 8px #0005}.bubble svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8}
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
        background-image:url("/essensplan_static/kitchen-background.svg?v=0.7.2"),
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
        border:1px solid var(--ep-edge);border-radius:20px;padding:6px;
        background:var(--secondary-background-color,var(--ep-surface));
      }
      nav button{border-color:transparent}
      nav button[aria-current=page]{border-color:var(--ep-accent);font-weight:650}
      dialog{box-shadow:0 16px 54px #0005,inset 0 1px 0 var(--ep-glint)}
      @supports (color:color-mix(in srgb,white,black)){
        ha-card{
          background-image:url("/essensplan_static/kitchen-background.svg?v=0.7.2"),
            radial-gradient(ellipse at 2% 0%,color-mix(in srgb,#e6ad7d 20%,transparent),transparent 63%),
            radial-gradient(ellipse at 96% 16%,color-mix(in srgb,#9baa7f 18%,transparent),transparent 65%),
            radial-gradient(ellipse at 5% 100%,color-mix(in srgb,var(--ep-accent) 12%,transparent),transparent 66%);
          background-size:min(100%,640px) auto,100% 420px,100% 420px,100% 360px;
          background-position:top right,top left,top right,bottom left;
        }
        .recipe-card,.tile,.day form{background:color-mix(in srgb,var(--ep-surface) 86%,transparent)}
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
        ha-card,.recipe-card,.tile,.day form,.bubble,dialog{background:var(--ep-surface);backdrop-filter:none}
      }
      .hint{font-size:13px;line-height:1.5}.spacer{margin-top:12px}@media(max-width:450px){ha-card{padding:12px}.day .row{gap:6px}nav{gap:4px}nav button{font-size:12px}}
    </style><ha-card><div id="error" role="alert">${esc(this._error)}</div>${this._notice?`<p role="status" tabindex="-1">${esc(this._notice)}</p>`:''}${body}${nav}</ha-card>`;
    this.bind();
  }
  todayHTML() {
    const stamp = this.data.today, count = this.slotCount(stamp);
    return `<div class="meals">${Array.from({length:count},(_,slot)=>{
      const {meal, recipe} = this.recipeFor(stamp, slot);
      return `<button class="tile" id="${slot ? `today-${slot}` : 'today'}" data-today-slot="${slot}" aria-label="Gericht ${slot+1}: ${esc(recipe?.name || 'Heute noch nichts geplant')}. Tippen für Rezept, gedrückt halten für Wochenplan.">
      ${recipe?.image ? `<img class="hero" alt="" src="${esc(recipe.image)}">` : '<span class="emoji" aria-hidden="true">🍽️</span>'}
      <small>${esc(this.config.title || 'Heute auf dem Tisch')} · ${esc(labelDate(stamp))}${count>1?` · Gericht ${slot+1}`:''}</small>
      <strong>${esc(recipe?.name || 'Noch nichts geplant')}</strong><small>${meal ? `${esc(meal.servings)} Portionen${meal.prepared_from?' · vorbereitet':''} · Rezept öffnen` : 'Im Wochenplan ein Gericht auswählen'}</small></button>`;
    }).join('')}</div>
      <div class="actions spacer"><button data-act="week">Wochenplan</button><button data-mode="recipes">Rezepte</button><button data-mode="shopping">Einkauf</button></div>`;
  }
  weekHTML() {
    const recipes = Object.values(this.data.recipes).sort((a,b)=>a.name.localeCompare(b.name,'de'));
    return `<div class="row"><h2>Unser Wochenplan</h2><div class="actions"><button data-shift="-7" aria-label="Vorherige Woche">←</button><button data-act="this-week">Heute</button><button data-shift="7" aria-label="Nächste Woche">→</button></div></div>
      <p class="muted">${esc(labelDate(this.week))} – ${esc(labelDate(offsetDay(this.week,6)))}</p>
      ${!recipes.length ? '<p>Lege zuerst unter „Rezepte“ dein erstes Gericht an.</p>' : ''}
      ${Array.from({length:7},(_,i)=>{const stamp=offsetDay(this.week,i),count=this.slotCount(stamp); return `<section class="day ${stamp===this.data.today?'today':''}" data-date="${stamp}"><strong>${esc(labelDate(stamp))}</strong>
      ${Array.from({length:count},(_,slot)=>{const {meal,recipe}=this.recipeFor(stamp,slot),draft=this._mealDrafts?.[`${stamp}/${slot}`],value=draft || meal;return `<form data-meal-slot="${slot}" data-revision="${draft?.revision ?? this.data.revision}">
      ${count>1?`<span class="muted">Gericht ${slot+1}</span>`:''}<div class="row"><select aria-label="Gericht ${slot+1} am ${stamp}"><option value="">Noch offen</option>${recipes.map(r=>`<option value="${r.id}" ${value?.recipe_id===r.id?'selected':''}>${esc(r.name)}</option>`).join('')}</select>
      <input type="number" min="0.1" max="100" step="0.1" required value="${esc(value?.servings || 4)}" aria-label="Portionen für Gericht ${slot+1} am ${stamp}"><button type="submit" class="primary">Speichern</button>${recipe?`<button type="button" data-detail="${stamp}" data-slot="${slot}">Rezept</button><button type="button" data-meal-prep="${stamp}" data-slot="${slot}">Mealprep</button>`:''}</div>
      ${meal?.prepared_from?`<small>Vorbereitet am ${esc(labelDate(meal.prepared_from.date))}</small>`:meal?.cook_servings?`<small>${esc(meal.cook_servings)} Portionen kochen</small>`:''}</form>`;}).join('')}</section>`;}).join('')}
      <p class="hint">Beim Speichern wird die Einkaufsliste automatisch auf diese Woche umgestellt. „Noch offen“ + Speichern entfernt ein Gericht.</p>
      <p class="hint">Gerichte pro Tag: ${this.data.meals_per_day || 1}. Änderbar unter Einstellungen → Geräte & Dienste → Essensplan → Konfigurieren (1–6). Bereits belegte zusätzliche Plätze bleiben erhalten.</p>
      <div class="actions"><button data-act="shopping-week">Einkaufsliste für diese Woche anzeigen</button><button data-act="reload-plan">Plan neu laden und ungespeicherte Änderungen verwerfen</button></div>`;
  }
  detailHTML() {
    const stamp = this._selectedDate || new URLSearchParams(location.search).get('meal_date') || this.data.today;
    const slot = this._selectedSlot ?? Number(new URLSearchParams(location.search).get('meal_slot') || 0);
    const {meal,recipe} = this.recipeFor(stamp, slot);
    const direct = this._recipeId ? this.data.recipes[this._recipeId] : null;
    const r = direct || recipe;
    if (!r) return '<h2>Noch kein Gericht geplant</h2><p>Wähle im Wochenplan ein Rezept aus.</p>';
    const servings = direct ? Number(r.servings) : Number(meal.servings);
    const factor = Number(meal?.cook_servings || servings)/Number(r.servings);
    return `${r.image?`<img class="hero" src="${esc(r.image)}" alt="${esc(r.name)}">`:''}<h2>${esc(r.name)}</h2><p class="muted">${pretty(servings)} Portionen${direct?'':` · ${esc(labelDate(stamp))}${this.slotCount(stamp)>1?` · Gericht ${slot+1}`:''}`}</p>
      ${meal?.prepared_from?`<p>Vorbereitet am ${esc(labelDate(meal.prepared_from.date))}.</p>`:meal?.cook_servings?`<p>Zutaten für insgesamt ${esc(meal.cook_servings)} Kochportionen.</p>`:''}
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
  recipesHTML() {
    const calendar = '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m-9 2v7m-3.5-3.5h7"/>';
    const book = '<path d="M12 6v15M3 5c4-1 7 0 9 2 2-2 5-3 9-2v14c-4-1-7 0-9 2-2-2-5-3-9-2z"/>';
    const bubble = (action, id, label, icon) => `<button class="bubble" data-${action}="${esc(id)}" aria-label="${esc(label)}" title="${esc(label)}"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg></button>`;
    return `<div class="row"><h2>Unsere Rezepte</h2><button class="primary" data-act="new">+ Rezept</button></div>
      <div class="row"><label style="flex:1">Rezepte oder Zutaten suchen<input type="search" id="recipe-search" placeholder="z. B. Paprika" value="${esc(this._recipeSearch || '')}"></label>
      <button type="button" id="favorites-only" aria-pressed="${Boolean(this._favoritesOnly)}">${this._favoritesOnly?'★ Nur Favoriten':'☆ Nur Favoriten'}</button></div>
      <p id="recipe-match-count" class="muted" aria-live="polite"></p>
      <div class="recipe-grid">${Object.values(this.data.recipes).map(r=>`<article class="recipe-card" data-recipe-card="${esc(r.id)}">
      <div class="recipe-media">${this.recipeImage(r)}<div class="bubbles">${bubble('schedule',r.id,`${r.name} einplanen`,calendar)}${bubble('recipe',r.id,`Rezeptdetails: ${r.name}`,book)}</div></div>
      <div class="recipe-info"><h3>${esc(r.name)}</h3><small>${this.recipeMeta(r)}</small><div class="actions"><button data-favorite="${esc(r.id)}" aria-pressed="${Boolean(r.favorite)}">${r.favorite?'★ Favorit':'☆ Favorit'}</button><button data-edit="${esc(r.id)}">Bearbeiten</button><button class="danger" data-delete="${esc(r.id)}">Löschen</button></div></div></article>`).join('')}</div>
      ${Object.keys(this.data.recipes).length?'':'<p>Hier entsteht eure persönliche Rezeptsammlung. Bilder sind optional.</p>'}`;
  }
  openRecipeDialog(id, trigger, schedule = false, editMeal) {
    const r = this.data.recipes[id];
    if (!r || this._saving) return;
    const root = this.shadowRoot;
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-labelledby', 'recipe-dialog-title');
    const revision = this.data.revision;
    const previous = root.querySelector('dialog');
    if (previous) previous.remove();
    const current=editMeal ? this.mealsFor(editMeal.date)[editMeal.slot] : null;
    dialog.innerHTML = schedule ? `<h2 id="recipe-dialog-title">${esc(r.name)} einplanen</h2><form>
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
      <p role="alert" id="dialog-error"></p><div class="actions"><button type="submit" class="primary">Einplanen</button><button type="button" data-close>Abbrechen</button></div></form>` :
      `<div class="recipe-media detail-cover">${this.recipeImage(r)}</div><h2 id="recipe-dialog-title">${esc(r.name)}</h2><p class="muted">${this.recipeMeta(r)}</p>
      <h3>Zutaten</h3><ul>${(r.ingredients.length ? r.ingredients.map(i=>`<li>${i.quantity == null ? esc(i.name) : `${pretty(Number(i.quantity))} ${esc(i.unit)} ${esc(i.name)}`}</li>`).join('') : '<li>Keine Zutaten eingetragen</li>')}</ul>
      <h3>Zubereitung</h3>${r.steps.length ? '' : '<p>Keine Zubereitung eingetragen.</p>'}<ol>${r.steps.map(step=>`<li>${esc(step).replace(/\n/g,'<br>')}</li>`).join('')}</ol>
      <div class="actions"><button class="primary" data-plan>Einplanen</button><button data-close>Schließen</button></div>`;
    root.append(dialog);
    dialog.addEventListener('close',()=>{dialog.remove();if(trigger?.isConnected) trigger.focus();});
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();
    this.bindRecipeImages(dialog);
    if (!schedule) {
      dialog.querySelector('[data-plan]').onclick=()=>this.openRecipeDialog(id,trigger,true);
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
          !this.mealsFor(leftoverDate.value)[i] && !this._mealDrafts?.[`${leftoverDate.value}/${i}`]);
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
          if(left>0.0001) available.push([`${stamp}/${index}`,`Vorbereitet: ${labelDate(stamp)}, Gericht ${index+1} (${pretty(left)} frei)`]);
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
    this.clearImagePreview();
    const r = this.data.recipes[id] || {name:'',servings:4,image:'',ingredients:[],steps:[]};
    this._editId = id || null;
    this._editRevision = this.data.revision;
    this.shadowRoot.querySelector('ha-card').innerHTML = `<h2>${id?'Rezept bearbeiten':'Neues Rezept'}</h2><div id="error" role="alert"></div><form>
      <div class="actions"><button type="button" id="choose-screenshot">Zutaten aus Screenshot übernehmen</button></div>
      <input id="recipe-screenshot" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Rezept-Screenshot auswählen" hidden>
      <p class="hint" id="ocr-status" role="status"></p>
      <div id="ocr-review" hidden><label for="ocr-text">Erkannte Zutaten · eine pro Zeile</label>
      <textarea id="ocr-text"></textarea><p id="ocr-diff" class="hint"></p><button type="button" id="apply-ocr">Neue Zutaten hinzufügen</button>
      <p class="hint">Vorhandene Zutaten und ihre Mengen bleiben erhalten.</p></div>
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
      let ocr;
      const ingredientKey=name=>name.normalize('NFKC').toLocaleLowerCase('de').trim().replace(/\s+/g,' ');
      const previewItems=()=>{
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
      screenshot.onchange=async()=>{
        const file=screenshot.files[0];
        screenshot.value='';
        if (!file || saving) return;
        choose.disabled=true;
        review.hidden=true;
        status.textContent='Screenshot wird auf diesem Gerät gelesen …';
        try {
          ocr=await import('/essensplan_static/recipe-ocr.mjs?v=0.7.2');
          const recognized=await ocr.recognizeRecipe(file, progress=>{
            if (form.isConnected) status.textContent=`Screenshot wird lokal gelesen … ${progress} %`;
          });
          if (!form.isConnected) return;
          const found=ocr.extractIngredientLines(recognized.slice(0,16000));
          if (!found.length) throw new Error('Keine Zutatenliste erkannt. Wähle einen Ausschnitt mit der Überschrift „Zutaten“ oder nur der Liste.');
          raw.value=found.join('\n');
          review.hidden=false;
          previewItems();
          status.textContent=`${found.length} Zutatenzeilen erkannt. Du kannst sie vor dem Übernehmen korrigieren.`;
        } catch (error) {
          if (form.isConnected) status.textContent=error.message || 'Screenshot konnte nicht gelesen werden.';
        } finally { if (form.isConnected) choose.disabled=false; }
      };
      field('apply-ocr').onclick=()=>{
        if (!ocr || saving) return;
        const draft=previewItems();
        if (!draft.length) {
          status.textContent='Keine neuen Zutaten zum Übernehmen.';
          return;
        }
        for (const row of [...ingredients.children]) if (![...row.querySelectorAll('input,select')].some(el=>el.value.trim())) row.remove();
        const added=draft.slice(0,100-ingredients.childElementCount);
        added.forEach(item=>appendIngredient({...item,name:item.name.slice(0,200)}));
        status.textContent=`${added.length} neue Zutaten übernommen.${added.length<draft.length?' Höchstens 100 Zutaten passen in ein Rezept.':''} Prüfe Mengen und Einheiten.`;
        review.hidden=true;
        raw.value='';
        ingredients.querySelector('[data-name]')?.focus();
      };
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
    root.querySelectorAll('[data-meal-prep]').forEach(el=>el.onclick=()=>{
      const date=el.dataset.mealPrep, slot=Number(el.dataset.slot), meal=this.mealsFor(date)[slot];
      if (this._mealDrafts?.[`${date}/${slot}`]) {
        root.querySelector('#error').textContent='Speichere zuerst die Änderungen an diesem Platz.';
        return;
      }
      if(meal) this.openRecipeDialog(meal.recipe_id,el,true,{date,slot});
    });
    root.querySelectorAll('[data-mode]').forEach(el=>el.onclick=()=>{this._recipeId=null;this.navigate(el.dataset.mode);});
    root.querySelectorAll('[data-shift]').forEach(el=>el.onclick=()=>{this.week=offsetDay(this.week,Number(el.dataset.shift));this.render();});
    root.querySelectorAll('[data-detail]').forEach(el=>el.onclick=()=>{this._recipeId=null;this.navigate('detail',el.dataset.detail,Number(el.dataset.slot || 0));});
    this.bindRecipeImages(root);
    root.querySelectorAll('[data-recipe]').forEach(el=>el.onclick=()=>this.openRecipeDialog(el.dataset.recipe,el));
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
        case 'reload-plan': this._mealDrafts={};this._error='';await this.load();this.render();break;
        case 'shopping-week': if(await this.change('shopping_week',{date:this.week}))this.navigate('shopping');break;
      }
    });
    root.querySelectorAll('form[data-meal-slot]').forEach(form=>{
      const stamp=form.closest('[data-date]').dataset.date, slot=Number(form.dataset.mealSlot);
      const input=form.querySelector('input'), select=form.querySelector('select');
      const remember=()=>{
        this._mealDrafts ||= {};
        this._mealDrafts[`${stamp}/${slot}`]={recipe_id:select.value,servings:input.value,revision:Number(form.dataset.revision)};
      };
      select.onchange=remember;input.oninput=remember;
      form.onsubmit=async event=>{
        event.preventDefault();
        if (!form.reportValidity()) return;
        remember();
        await this.change('set_meal',{date:stamp,slot,recipe_id:select.value||null,servings:input.value},Number(form.dataset.revision));
      };
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
      tile.onclick=()=>{cancel();if(!held){this._recipeId=null;this.navigate(this.recipeFor(this.data.today,slot).recipe?'detail':'week',this.data.today,slot);}held=false;};
    });
  }
}
if(!customElements.get('essensplan-card')) customElements.define('essensplan-card',EssensplanCard);
window.customCards=window.customCards||[];
if (!window.customCards.some(card=>card.type==='essensplan-card')) {
  window.customCards.push({type:'essensplan-card',name:'Essensplan',description:'Tagesgericht, Wochenplan, Rezepte und Einkaufsliste',preview:false});
}
