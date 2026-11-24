/* Recipe cards, recipe dialogs, images, screenshot import and the editor. Mixed into the card class. */
import {esc, offsetDay, monday, labelDate, pretty, prepareRecipeImage} from './util.mjs?v=0.16.1';

export const recipesMethods = {
  recipeImage(r) {
    const fallback = '/essensplan_static/recipe-placeholder.svg';
    return `<img data-recipe-image src="${esc(r.image || fallback)}" alt="" loading="lazy" decoding="async">`;
  },
  recipeMeta(r) {
    return `${r.minutes ? `${esc(r.minutes)} Min. · ` : 'Dauer nicht angegeben · '}${esc(r.servings)} Portionen`;
  },
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
  },
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
  },
  bindRecipeImages(root) {
    root.querySelectorAll('[data-recipe-image]').forEach(img=>{
      const fallback=()=>{img.onerror=null;img.src='/essensplan_static/recipe-placeholder.svg';};
      img.onerror=fallback;
      if(img.complete && !img.naturalWidth) fallback();
    });
  },
  clearOcrPreview() {
    this._ocrAbort?.abort();
    this._ocrAbort=null;
    for (const url of this._ocrPreviewUrls || []) URL.revokeObjectURL(url);
    this._ocrPreviewUrls=[];
  },
  clearImagePreview() {
    if (this._imagePreviewUrl) URL.revokeObjectURL(this._imagePreviewUrl);
    this._imagePreviewUrl=null;
  },
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
  },
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
          ocr=await import('/essensplan_static/recipe-ocr.mjs?v=0.16.1');
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
};
