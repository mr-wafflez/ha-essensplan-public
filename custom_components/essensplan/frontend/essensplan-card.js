/* Essensplan 0.17.0 – bundled with the integration; no CDN or build step. */
import {esc, offsetDay, monday} from './card/util.mjs?v=0.17.0';
import {CARD_STYLES} from './card/styles.mjs?v=0.17.0';
import {planMethods} from './card/plan.mjs?v=0.17.0';
import {recipesMethods} from './card/recipes.mjs?v=0.17.0';
import {nutritionMethods} from './card/nutrition.mjs?v=0.17.0';
import {shoppingMethods} from './card/shopping.mjs?v=0.17.0';

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
    this.subscribe();
  }
  connectedCallback() {
    window.addEventListener('popstate', this._urlChanged);
    window.addEventListener('location-changed', this._urlChanged);
    // Home Assistant pushes changes; the poll is only a fallback, rarely needed.
    this._interval = window.setInterval(() => {
      if (!this._unsubscribe || Date.now() - (this._loadedAt || 0) > 600000) this.load();
    }, 60000);
    if (this._hass) { this.load(); this.subscribe(); }
  }
  async subscribe() {
    const connection=this._hass?.connection;
    if (this._unsubscribe || this._subscribing || !connection?.subscribeMessage || !this.isConnected) return;
    this._subscribing=true;
    try {
      const unsubscribe=await connection.subscribeMessage(event=>{
        if (!this.data || event.revision!==this.data.revision || event.today!==this.data.today) this.load();
      },{type:'essensplan/subscribe'});
      if (this.isConnected) this._unsubscribe=unsubscribe;
      else unsubscribe();
    } catch {
      this._unsubscribe=null;
    } finally { this._subscribing=false; }
  }
  disconnectedCallback() {
    clearInterval(this._interval); clearTimeout(this._hold);
    const unsubscribe=this._unsubscribe; this._unsubscribe=null;
    Promise.resolve().then(()=>unsubscribe?.()).catch(()=>{});
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
      this._loadedAt = Date.now();
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
    this.shadowRoot.innerHTML = `<style>${CARD_STYLES}</style><ha-card>${nav}<div id="error" role="alert">${esc(this._error)}</div>${this._notice?`<p role="status" tabindex="-1">${esc(this._notice)}</p>`:''}${body}</ha-card>`;
    this.bind();
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
Object.assign(EssensplanCard.prototype, planMethods, recipesMethods, nutritionMethods, shoppingMethods);
