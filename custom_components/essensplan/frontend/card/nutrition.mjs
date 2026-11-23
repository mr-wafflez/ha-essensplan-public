/* Nutrition module: ingredient list, search and scan, amounts table. Mixed into the card class. */
import {esc, pretty} from './util.mjs?v=0.16.0';

export const nutritionMethods = {
  nutritionHTML(recipe, showTotal = false) {
    if (!this.data.modules?.nutrition) return '';
    const nutrition=this.data.nutrition?.[recipe.id];
    const groupsByStatus=nutrition?.open || {};
    const open=Object.values(groupsByStatus).flat();
    if (!nutrition?.used) return `<p class="hint">Nährwerte noch nicht berechenbar${open.length?` · ${open.length} ${open.length===1?'Zutat':'Zutaten'} offen`:''}.</p>`;
    const format=values=>`${pretty(Math.round(values.kcal))} kcal · ${pretty(Math.round(values.protein))} g Protein · ${pretty(Math.round(values.carbs))} g Kohlenhydrate · ${pretty(Math.round(values.fat))} g Fett`;
    const missing=open.length ? ` · ${open.length} ${open.length===1?'Zutat':'Zutaten'} fehlt` + (open.length===1?'':'en') : '';
    const groups=[['amount','Menge fehlt'],['mapping','Nicht zugeordnet'],['weight','Gewicht fehlt']]
      .map(([status,label])=>[label,groupsByStatus[status] || []]).filter(([,names])=>names.length);
    return `<p class="hint"><strong>Pro Portion${missing?' · unvollständig':''}</strong><br>${format(nutrition.portion)}</p>
      ${showTotal?`<p class="hint"><strong>Gesamtgericht${missing?' · unvollständig':''}</strong><br>${format(nutrition.total)}</p>
      ${groups.map(([label,names])=>`<p class="hint">${label}: ${esc(names.join(', '))}</p>`).join('')}`:''}`;
  },
  ingredientKey(name) {
    // Mirrors nutrition.key() in Python: casefold, strip accents, keep a-z/0-9 words.
    return (String(name ?? '').replace(/ß/g,'ss').toLowerCase().normalize('NFKD')
      .replace(/[^\x00-\x7f]/g,'').match(/[a-z0-9]+/g) || []).join(' ');
  },
  ingredientEntry(name) {
    const key=this.ingredientKey(name);
    const generic={el:{grams:'10',source:'generic'},tl:{grams:'4',source:'generic'},prise:{grams:'0.3',source:'generic'},ml:{grams:'1',source:'generic'}};
    return (this._ingredients?.ingredient_list || []).find(entry=>entry.key===key) || {key,name,recipes:0,units:[],status:'open',
      ignore:false,nutrition:null,label:'',weights:generic,defaults:generic};
  },
  // The state of one ingredient as the dialogs show it: saved entry plus not yet saved edits.
  ingredientView(entry, staged) {
    const change=staged.get(entry.key);
    if (!change) return entry;
    const weights={...(entry.defaults||{})};
    for (const [unit,grams] of Object.entries(change.raw.weights||{})) weights[unit]={grams,source:'own'};
    return {...entry, nutrition:change.raw.nutrition, label:change.label, ignore:change.raw.ignore,
      status:change.raw.ignore?'ignored':change.raw.nutrition?'mapped':'open', weights};
  },
  ownWeights(view) {
    return Object.fromEntries(Object.entries(view.weights).filter(([,w])=>w.source==='own').map(([unit,w])=>[unit,w.grams]));
  },
  stageSuggestion(staged, entry, view, suggestion) {
    staged.set(entry.key,{raw:{name:entry.name,nutrition:{code:suggestion.code},weights:this.ownWeights(view),ignore:false},
      label:suggestion.name});
  },
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
  },
  unitLabel(unit) {
    return {'':'–',g:'g',kg:'kg',ml:'ml',l:'l','stück':'Stück',el:'EL',tl:'TL',prise:'Prise',bund:'Bund',dose:'Dose'}[unit] ?? unit;
  },
  weightText(view) {
    const parts=Object.entries(view.weights).filter(([unit,w])=>w.source!=='generic' && unit!=='ml' &&
      (view.units.includes(unit) || w.source==='own')).map(([unit,w])=>`1 ${this.unitLabel(unit)} = ${pretty(Number(w.grams))} g`);
    return parts.join(' · ');
  },
  async ingredientSuggestions(names) {
    const result=new Map();
    for (let start=0; start<names.length; start+=100) {
      const chunk=names.slice(start,start+100);
      const lists=await this._hass.callWS({type:'essensplan/nutrition_search',queries:chunk});
      chunk.forEach((name,index)=>result.set(this.ingredientKey(name),lists[index]));
    }
    return result;
  },
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
    const scanner=()=>import('/essensplan_static/barcode/scanner.mjs?v=0.16.0');
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
  },
  ingredientDialog(title) {
    const root=this.shadowRoot;
    this._barcodeStop?.();
    root.querySelector('dialog')?.remove();
    const dialog=document.createElement('dialog');
    dialog.className='wide';
    dialog.setAttribute('aria-label',title);
    root.append(dialog);
    return dialog;
  },
  // The ingredient list is large, so it is loaded only for the nutrition dialogs.
  async loadIngredients() {
    if (this._ingredients?.revision === this.data.revision) return true;
    try {
      this._ingredients=await this._hass.callWS({type:'essensplan/ingredients'});
      return true;
    } catch (err) {
      this._error=err.message || 'Zutatenliste konnte nicht geladen werden.';
      const box=this.shadowRoot.querySelector('#error');
      if (box) box.textContent=this._error;
      return false;
    }
  },
  async openIngredients(trigger) {
    if (!this.data.modules?.nutrition || this._saving || !(await this.loadIngredients())) return;
    const dialog=this.ingredientDialog('Zutaten & Nährwerte');
    const staged=new Map();
    let suggestions=new Map(), filter='open', query='', openKey=null, focusPanel=false;
    const entries=()=>this._ingredients?.ingredient_list || [];
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
  },
  async openAmounts(id, trigger) {
    if (!this.data.modules?.nutrition || this._saving || !(await this.loadIngredients())) return;
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
};
