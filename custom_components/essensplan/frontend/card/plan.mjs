/* Today, week plan, slot actions and recipe detail. Mixed into the card class. */
import {esc, offsetDay, labelDate, pretty} from './util.mjs?v=0.16.0';

export const planMethods = {
  todayHTML() {
    const stamp = this.data.today, count = this.slotCount(stamp);
    return `<div class="meals">${Array.from({length:count},(_,slot)=>{
      const {meal, recipe} = this.recipeFor(stamp, slot);
      return `<button class="tile" id="${slot ? `today-${slot}` : 'today'}" data-today-slot="${slot}" aria-label="Gericht ${slot+1}: ${esc(recipe?.name || 'Heute noch nichts geplant')}. ${recipe ? 'Tippen für Rezept, gedrückt halten für Wochenplan.' : 'Tippen, um ein Gericht auszuwählen.'}">
      ${recipe?.image ? `<img class="hero" alt="" src="${esc(recipe.image)}">` : '<span class="emoji" aria-hidden="true">🍽️</span>'}
      <small>${esc(this.config.title || 'Heute auf dem Tisch')} · ${esc(labelDate(stamp))}${count>1?` · Gericht ${slot+1}`:''}</small>
      <strong>${esc(recipe?.name || 'Noch nichts geplant')}</strong>${meal ? `<small>${esc(meal.servings)} Portionen${meal.prepared_from?' · '+esc(this.prepLabel(meal.prepared_from)):''}</small>` : ''}<span class="cta">${meal ? 'Rezept öffnen ›' : 'Gericht auswählen ›'}</span></button>`;
    }).join('')}</div>`;
  },
  prepLabel(source) {
    const cooked=this.mealsFor(source.date)[source.slot]?.cooked;
    return (cooked?'Vorbereitet am ':'Geplante Reste · Kochtag ')+labelDate(source.date);
  },
  sparePortions(date,slot,meal) {
    let spare=Number(meal.cook_servings)-Number(meal.servings);
    for (const stamp of Object.keys(this.data.plan)) for (const item of this.mealsFor(stamp)) {
      if (item?.prepared_from?.date===date && item.prepared_from.slot===slot) spare-=Number(item.servings);
    }
    return Number(spare.toFixed(3));
  },
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
  },
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
  },
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
  },
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
  },
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
};
