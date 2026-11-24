/* Shopping list view and amounts for unmeasured ingredients. Mixed into the card class. */
import {esc, offsetDay, monday, labelDate} from './util.mjs?v=0.16.1';

export const shoppingMethods = {
  shoppingHTML() {
    const week = this.data.shopping_week || monday(this.data.today);
    return `<h2>Einkaufsliste</h2><p class="muted">${esc(labelDate(week))} – ${esc(labelDate(offsetDay(week,6)))}</p>${this.data.shopping.map(i=>`<div class="row"><label class="check ${i.completed?'done':''}" style="flex:1"><input type="checkbox" data-check="${i.uid}" ${i.completed?'checked':''}><span>${esc(i.summary)}</span></label>${i.amount_key?`<button type="button" data-amount="${esc(i.amount_key)}">${i.amount?'Menge ändern':'Menge ergänzen'}</button>`:''}</div>`).join('') || '<p>Noch keine Zutaten. Plane Gerichte für diese Woche.</p>'}<p class="hint">Ergänzte Mengen gelten nur für diese Einkaufswoche. Geänderte Mengen werden wieder offen.</p>`;
  },
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
};
