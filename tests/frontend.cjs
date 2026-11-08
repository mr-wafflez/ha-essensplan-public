/* Browser smoke tests with a mocked HA WebSocket boundary. Requires Playwright. */
const path = require('node:path');
const {createRequire} = require('node:module');
const req = createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || process.cwd()+'/node_modules','_entry.js'));
const {chromium} = req('playwright');
const assert = require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.ESSENSPLAN_BROWSER_EXECUTABLE?{executablePath:process.env.ESSENSPLAN_BROWSER_EXECUTABLE}:{})});
 try {
 const page=await browser.newPage({viewport:{width:1024,height:768},hasTouch:true});
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.route('http://essensplan.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="de"><body style="font-family:sans-serif;background:#f5f5f5"><main style="max-width:700px;margin:24px auto"></main></body></html>'}));
 await page.route('**/recipe-placeholder.svg',route=>route.fulfill({path:path.join(__dirname,'../custom_components/essensplan/frontend/recipe-placeholder.svg'),contentType:'image/svg+xml'}));
 const external=[];
 await page.route(url=>url.origin!=='http://essensplan.test', route=>{external.push(route.request().url());return route.abort();});
 await page.route('http://essensplan.test/essensplan_static/**',route=>{
  const name=new URL(route.request().url()).pathname.slice('/essensplan_static/'.length);
  if (name==='recipe-placeholder.svg') return route.fallback();
  if (!/^(recipe-ocr\.mjs|ocr\/[a-z0-9.-]+)$/.test(name)) return route.fulfill({status:404,body:''});
  return route.fulfill({path:path.join(__dirname,'../custom_components/essensplan/frontend',name),
   contentType:/\.m?js$/.test(name)?'text/javascript':'application/octet-stream'});
 });
 await page.goto('http://essensplan.test/');
 await page.addScriptTag({path:path.join(__dirname,'../custom_components/essensplan/frontend/essensplan-card.js')});
 await page.evaluate(()=>{
  window.state={today:'2026-10-15',revision:0,completed:[],shopping_week:'2026-10-12',shopping:[{uid:'s1',summary:'500 g Hähnchen',completed:false}],
   recipes:{r1:{id:'r1',name:'Hähnchen-Curry <sicher>',servings:'4',image:'',ingredients:[{quantity:'500',unit:'g',name:'Hähnchen'}],steps:['Hähnchen würfeln.','Mit Kokosmilch garen.']}},plan:{'2026-10-15':{recipe_id:'r1',servings:'2'}}};
  window.calls=[];
  window.hass={states:{},callWS:async cmd=>{calls.push(cmd);if(cmd.type==='essensplan/change'){
   if(cmd.revision!==state.revision)throw Error('Revisionskonflikt');
   if(cmd.operation==='save_recipe'){const r=cmd.payload;state.recipes[r.id||'new']={...r,id:r.id||'new'};}
   if(cmd.operation==='favorite'){state.recipes[cmd.payload.id].favorite=cmd.payload.favorite;}
   if(cmd.operation==='shopping_amount'){
    const p=cmd.payload,item=state.shopping.find(i=>i.amount_key===p.key);
    item.amount={quantity:p.quantity,unit:p.unit};item.summary=p.quantity+' '+p.unit+' '+item.ingredient;
   }
   if(cmd.operation==='complete'){state.shopping.find(i=>i.uid===cmd.payload.uid).completed=cmd.payload.completed;}
   if(cmd.operation==='mark_cooked'){
    const p=cmd.payload, meals=state.plan[p.date];
    (Array.isArray(meals)?meals[p.slot]:meals).cooked=p.cooked;
   }
   if(cmd.operation==='set_meal'){
    if(window.rejectMeal) throw Error('Speichern fehlgeschlagen');
    const p=cmd.payload,old=state.plan[p.date],meals=Array.isArray(old)?old:old?[old]:[],slot=p.slot||0;
    while(meals.length<=slot)meals.push(null);
    meals[slot]=p.recipe_id?{recipe_id:p.recipe_id,servings:p.servings,...(p.cook_servings?{cook_servings:p.cook_servings}:{}),...(p.prepared_from?{prepared_from:p.prepared_from}:{})}:null;
    while(meals.length&&meals.at(-1)===null)meals.pop();
    if(meals.length)state.plan[p.date]=meals;else delete state.plan[p.date];
    if(p.leftover) {
     const {date,slot,servings}=p.leftover, target=state.plan[date] ||= [];
     while(target.length<=slot)target.push(null);
     target[slot]={recipe_id:p.recipe_id,servings,prepared_from:{date:p.date,slot:p.slot}};
    }
   }
   state.revision++;
  }return structuredClone(state);}};
  const card=document.createElement('essensplan-card');card.setConfig({mode:'today'});document.querySelector('main').append(card);card.hass=hass;window.card=card;
 });
 const card=page.locator('essensplan-card');
 const capture=async (name, locator)=>{
  if (process.env.ESSENSPLAN_DOC_IMAGES) await locator.screenshot({path:path.join(process.env.ESSENSPLAN_DOC_IMAGES,name+'.png'),animations:'disabled'});
 };
 await card.locator('#today').waitFor();
 assert.match(await card.locator('#today').innerText(),/Hähnchen-Curry <sicher>/);
 await card.locator('#today').click();
 assert.equal(await card.locator('h2').innerText(),'Hähnchen-Curry <sicher>');
 assert.match(await card.locator('ul').innerText(),/250 g Hähnchen/);
 await card.locator('[data-mode="today"]').click();
 const box=await card.locator('#today').boundingBox();
 await page.mouse.move(box.x+20,box.y+20);await page.mouse.down();await page.waitForTimeout(700);await page.mouse.up();
 assert.equal(await card.locator('h2').innerText(),'Unser Wochenplan');
 assert.equal(await card.locator('.day').count(),7);
 await card.locator('[data-mode="recipes"]').click();await card.locator('[data-act="new"]').click();
 const screenshot=await page.evaluate(()=>{
  const c=document.createElement('canvas');c.width=940;c.height=570;const ctx=c.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,940,570);ctx.fillStyle='#111';ctx.font='32px Arial';
  ['Kartoffelsuppe','Für 4 Portionen','Zutaten:','500 g Kartoffeln','2 EL Öl','Zubereitung:','Kartoffeln waschen und kochen.']
   .forEach((line,i)=>ctx.fillText(line,46,65+i*70));
  return c.toDataURL('image/png').split(',')[1];
 });
 await card.locator('#recipe-screenshot').setInputFiles({name:'rezept.png',mimeType:'image/png',buffer:Buffer.from(screenshot,'base64')});
 await card.locator('#ocr-review').waitFor({timeout:30000});
 await card.locator('#ocr-preview').waitFor();
 assert(await card.locator('#ocr-preview').evaluate(img=>img.decode().then(()=>img.naturalHeight<570)));
 const recognizedLines=(await card.locator('#ocr-text').inputValue()).split('\n');
 assert.equal(recognizedLines.length,2);
 assert.equal(recognizedLines[0],'500 g Kartoffeln');
 await card.locator('#ocr-text').fill('500 g Kartoffeln\n2ELÖl');
 assert.match(await card.locator('#ocr-flags').innerText(),/Bitte prüfen: 2ELÖl/);
 await capture('screenshot-pruefung',card.locator('#ocr-review'));
 await card.locator('#ocr-text').fill('500 g Kartoffeln\n2 EL Öl');
 assert(await card.locator('#ocr-flags').isHidden());
 await card.locator('#name').fill('Eigener Name');
 await card.locator('#steps').fill('Eigene Zubereitung');
 await card.locator('#servings').fill('3');
 const cropUrl=await card.locator('#ocr-preview').getAttribute('src');
 await card.locator('#apply-ocr').click();
 assert(await page.evaluate(url=>fetch(url).then(()=>false,()=>true),cropUrl));
 assert.equal(await card.locator('#name').inputValue(),'Eigener Name');
 assert.equal(await card.locator('#servings').inputValue(),'3');
 assert.equal(await card.locator('#steps').inputValue(),'Eigene Zubereitung');
 assert.equal(await card.locator('.ingredient-row').first().locator('[data-unit]').inputValue(),'g');
 assert.equal(await card.locator('.ingredient-row').first().locator('[data-quantity]').inputValue(),'500');
 assert.deepEqual(external,[]);
 assert(await page.evaluate(()=>!calls.some(c=>c.operation==='save_recipe')));
 await card.locator('#cancel').click();
 if(process.env.ESSENSPLAN_OCR_FIXTURE) {
  await card.locator('[data-act="new"]').click();
  await card.locator('#recipe-screenshot').setInputFiles(process.env.ESSENSPLAN_OCR_FIXTURE);
  await card.locator('#ocr-review').waitFor({timeout:30000});
  const actual=await card.locator('#ocr-text').inputValue();
  assert.deepEqual(actual.split('\n'), ['Kartoffeln','Rinderhackfleisch','Zwiebeln','Knoblauch','Tomatenmark','Olivenöl',
   'Geriebener Käse','Salz & Pfeffer','Paprikapulver edelsüß','Paprikapulver rosenscharf','Oregano','Petersilie',
   '50 g Butter','50 g Mehl','500 ml Milch','Salz & Pfeffer','Muskatnuss']);
  await card.locator('#apply-ocr').click();
  const imported=card.locator('.ingredient-row');
  assert.equal(await imported.count(),16);
  assert.equal(await imported.nth(12).locator('[data-quantity]').inputValue(),'50');
  assert.equal(await imported.nth(14).locator('[data-unit]').inputValue(),'ml');
  assert.deepEqual(external,[]);
  await card.locator('#cancel').click();
 }
 if(process.env.ESSENSPLAN_OCR_GROUPED_FIXTURE) {
  await card.locator('[data-act="new"]').click();
  await card.locator('#recipe-screenshot').setInputFiles(process.env.ESSENSPLAN_OCR_GROUPED_FIXTURE);
  await card.locator('#ocr-review').waitFor({timeout:30000});
  const preview=await card.locator('#ocr-text').inputValue();
  assert.equal(preview.split('\n').length,15);
  assert.doesNotMatch(preview,/Gespeichert|Portionen|Hackbällchen:|Sauce:|Kartoffelpüree:|Zubereitung|kochen/);
  await card.locator('#apply-ocr').click();
  const imported=card.locator('.ingredient-row');
  const items=await imported.evaluateAll(rows=>rows.map(row=>[
   row.querySelector('[data-name]').value,row.querySelector('[data-quantity]').value,row.querySelector('[data-unit]').value]));
  assert.deepEqual(items,[
   ['Hackfleisch','500','g'],['Ei','1',''],['Semmelbrösel','80','g'],['Paprikapulver','1','tl'],['Salz & Pfeffer','',''],
   ['Zwiebel','1',''],['Knoblauchzehen','2',''],['Tomatenmark','1','el'],['Sahne','200','ml'],
   ['Gemüsebrühe','100','ml'],['Petersilie, Salz & Pfeffer','',''],['Kartoffeln','1.5','kg'],['Butter','100','g'],
   ['Milch','100','ml'],['Kartoffelwasser','100','ml'],['Muskat, Salz & Pfeffer','','']]);
  assert.deepEqual(external,[]);
  await card.locator('#cancel').click();
 }
 await card.locator('[data-act="new"]').click();
 await card.locator('#name').fill('Testgericht');
 const rows=card.locator('.ingredient-row');
 await rows.nth(0).locator('[data-name]').fill('Kartoffeln');
 await rows.nth(0).locator('[data-quantity]').fill('1');
 await rows.nth(0).locator('[data-unit]').selectOption('kg');
 await rows.nth(0).locator('[data-name]').press('Enter');
 await rows.nth(1).locator('[data-name]').fill('Eier');
 await card.locator('#add-ingredient').click();
 await rows.nth(2).locator('[data-name]').fill('Entfernen');
 await rows.nth(2).locator('[data-remove]').click();
 await card.locator('#steps').fill('Schneiden.\nKochen.');
 await card.locator('#minutes').fill('25');
 await card.locator('button[type=submit]').click();
 await card.locator('[data-edit="new"]').waitFor();
 await card.locator('#recipe-search').fill('Kartoffeln');
 assert.equal(await card.locator('[data-recipe-card]:visible').count(),1);
 await card.locator('[data-favorite="new"]').click();
 await card.locator('[data-favorite="new"][aria-pressed=true]').waitFor();
 await card.locator('#recipe-search').clear();
 await card.locator('#favorites-only').click();
 assert.equal(await card.locator('[data-recipe-card]:visible').count(),1);
 await card.locator('#favorites-only').click();
 assert.deepEqual(await page.evaluate(()=>calls.find(c=>c.operation==='save_recipe').payload.ingredients),
  [{name:'Kartoffeln',quantity:'1',unit:'kg'},{name:'Eier',quantity:'',unit:''}]);
 assert.match(await card.locator('.recipe-card').last().innerText(),/25 Min/);
 await card.locator('[data-recipe="new"]').tap();
 const dialog=card.locator('dialog');
 assert.match(await dialog.innerText(),/1 kg Kartoffeln/);
 assert.match(await dialog.innerText(),/Schneiden/);
 await dialog.locator('[data-plan]').click();
 assert(await dialog.locator('#replace-meal input').isVisible());
 await dialog.locator('[type=submit]').click();
 assert(await dialog.isVisible());
 await dialog.locator('#plan-date').fill('2026-10-17');
 await dialog.locator('#plan-servings').fill('2');
 await dialog.locator('#plan-cook').fill('6');
 assert.match(await dialog.locator('#plan-spare').innerText(),/4 Portionen übrig/);
 await dialog.locator('#plan-add-leftover').click();
 assert.equal(await dialog.locator('#leftover-date').inputValue(),'2026-10-18');
 assert.equal(await dialog.locator('#leftover-servings').inputValue(),'4');
 await dialog.locator('[type=submit]').click();
 assert.match(await card.locator('[role=status]').innerText(),/Kochtag.*Reste/);
 assert(await page.evaluate(()=>state.plan['2026-10-17'][0].servings==='2' &&
  state.plan['2026-10-18'][0].servings==='4' && state.plan['2026-10-18'][0].prepared_from.date==='2026-10-17' &&
  state.plan['2026-10-15'].recipe_id==='r1'));
 await page.setViewportSize({width:375,height:812});
 await page.evaluate(()=>document.documentElement.style.cssText='--primary-text-color:#eee;--card-background-color:#242629;--secondary-text-color:#ccc;--primary-color:#385473');
 await card.locator('[data-recipe="new"]').tap();
 assert(await dialog.locator('img').evaluate(img=>img.complete && img.naturalWidth > 0));
 assert(await dialog.evaluate(el=>el.getBoundingClientRect().width<innerWidth && getComputedStyle(el).color==='rgb(238, 238, 238)'));
 await page.keyboard.press('Escape');
 await dialog.waitFor({state:'hidden'});
 await page.setViewportSize({width:1024,height:768});
 // Unsaved text survives a periodic/background fetch.
 await card.locator('[data-edit="new"]').click();await card.locator('#name').fill('Ungespeichert');
 assert.equal(await rows.nth(0).locator('[data-unit]').inputValue(),'kg');
 assert.equal(await rows.nth(1).locator('[data-quantity]').inputValue(),'');
 await page.evaluate(()=>card.load());assert.equal(await card.locator('#name').inputValue(),'Ungespeichert');
 await card.locator('#cancel').click();
 await card.locator('[data-edit="new"]').click();
 await card.locator('#recipe-screenshot').setInputFiles({name:'rezept.png',mimeType:'image/png',buffer:Buffer.from(screenshot,'base64')});
 await card.locator('#ocr-review').waitFor({timeout:30000});
 await card.locator('#ocr-text').fill('500 g Kartoffeln\n1 TL Oregano');
 assert.match(await card.locator('#ocr-diff').innerText(),/1 neu.*Kartoffeln/);
 await card.locator('#apply-ocr').click();
 assert.equal(await rows.nth(0).locator('[data-quantity]').inputValue(),'1');
 assert.equal(await rows.nth(2).locator('[data-name]').inputValue(),'Oregano');
 await card.locator('#cancel').click();
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII=','base64');
 await page.route('**/api/image/serve/**',route=>route.fulfill({body:png,contentType:'image/png'}));
 await page.evaluate(()=>{
  window.uploads=0;
  hass.fetchWithAuth=async (url,options)=>{
   if(url!=='/api/image/upload' || options.body.get('file').type!=='image/jpeg') throw Error('unexpected upload');
   const id=(++window.uploads===1?'ab':'cd').repeat(16);
   return {ok:true,json:async()=>({id})};
  };
 });
 for(const id of ['ab','cd']){
  await card.locator('[data-edit="new"]').click();
  await card.locator('#image-file').setInputFiles({name:'bild.png',mimeType:'image/png',buffer:png});
  await card.locator('#image-preview').waitFor();
  await card.locator('button[type=submit]').click();
  await card.locator(`img[src="/api/image/serve/${id.repeat(16)}/original"]`).waitFor({state:'attached'});
 }
 await card.locator('[data-edit="new"]').click();
 await card.locator('#remove-image').click();
 await card.locator('button[type=submit]').click();
 await card.locator('[data-edit="new"]').waitFor();
 assert(await page.evaluate(()=>state.recipes.new.image==='' && uploads===2));
 await card.locator('[data-mode="shopping"]').click();await card.locator('[data-check="s1"]').check();
 assert(await page.evaluate(()=>calls.some(c=>c.operation==='complete'&&c.payload.completed)));
 await page.evaluate(()=>{
  state.shopping.push({uid:'s2',amount_key:'open',ingredient:'Paprika',summary:'Paprika (Menge offen)',completed:false});
  card.data=structuredClone(state);card.render();
 });
 await card.locator('[data-amount="open"]').click();
 await card.locator('#shopping-quantity').fill('2');
 await card.locator('#shopping-unit').selectOption('stück');
 await card.locator('dialog [type=submit]').click();
 assert.match(await card.locator('[data-check="s2"]').locator('..').innerText(),/2 stück Paprika/);
 // Route navigation retains the chosen date and uses real HA location changes.
 await page.evaluate(()=>{card.setConfig({mode:'today',detail_path:'/lovelace/rezept',week_path:'/lovelace/essen'});card._mode=null;card.render();});
 await card.locator('#today').click();assert.match(page.url(),/\/lovelace\/rezept\?meal_date=2026-10-15$/);
 // Two independently planned meals, per-slot navigation and scaled portions.
 await page.evaluate(()=>{
  state.meals_per_day=2;
  state.recipes.salad={id:'salad',name:'Salat',servings:'4',image:'',ingredients:[{quantity:'200',unit:'g',name:'Tomaten'}],steps:['Mischen.']};
  state.plan['2026-10-15']=[{recipe_id:'r1',servings:'2'},{recipe_id:'salad',servings:'6'}];
  card.data=structuredClone(state);card.setConfig({mode:'today'});card._mode=null;card.render();
 });
 assert.equal(await card.locator('[data-today-slot]').count(),2);
 await card.locator('#today-1').click();
 assert.equal(await card.locator('h2').innerText(),'Salat');
 assert.match(await card.locator('ul').innerText(),/300 g Tomaten/);
 await card.locator('[data-mode="week"]').click();
 assert.equal(await card.locator('form[data-meal-slot]').count(),14);
 const pick=card.locator('[data-pick-slot="2026-10-16"][data-slot="1"]');
 await pick.click();
 await dialog.locator('select').selectOption('recent');
 assert.match(await dialog.innerText(),/Keine passenden Rezepte/);
 await dialog.locator('select').selectOption('');
 await dialog.locator('input').fill('Tomaten');
 await capture('rezeptwahl',dialog);
 await dialog.locator('[data-pick="salad"]').click();
 assert.equal(await dialog.locator('#plan-date').inputValue(),'2026-10-16');
 assert.equal(await dialog.locator('#plan-slot').inputValue(),'1');
 await dialog.locator('[data-close]').click();
 await card.locator('[data-meal-prep="2026-10-15"][data-slot="0"]').click();
 await card.locator('#plan-cook').fill('6');
 await card.locator('dialog [type=submit]').click();
 await card.locator('dialog').waitFor({state:'hidden'});
 assert.match(await card.locator('[data-date="2026-10-15"]').innerText(),/4 Portionen noch nicht verplant/);
 await capture('mealprep',card.locator('[data-date="2026-10-15"]'));
 await card.locator('[data-leftover][data-meal-prep="2026-10-15"]').click();
 assert.equal(await dialog.locator('#leftover-date').inputValue(),'2026-10-16');
 await dialog.locator('[data-close]').click();
 await card.locator('[data-mode="recipes"]').click();
 await card.locator('[data-schedule="r1"]').click();
 await card.locator('#plan-date').fill('2026-10-16');
 await card.locator('#plan-source').selectOption('2026-10-15/0');
 await card.locator('#plan-servings').fill('4');
 await card.locator('dialog [type=submit]').click();
 await card.locator('dialog').waitFor({state:'hidden'});
 assert(await page.evaluate(()=>state.plan['2026-10-15'][0].cook_servings==='6' &&
  state.plan['2026-10-16'][0].prepared_from.date==='2026-10-15'));
 await card.locator('[data-mode="week"]').click();
 assert.match(await card.locator('[data-date="2026-10-16"]').innerText(),/Geplante Reste/);
 await card.locator('[data-cooked="2026-10-15"][data-slot="0"]').click();
 assert.match(await card.locator('[data-date="2026-10-16"]').innerText(),/Vorbereitet am/);
 await pick.click();
 await dialog.locator('select').selectOption('recent');
 assert.equal(await dialog.locator('[data-pick="r1"]').count(),1);
 await dialog.locator('[data-close]').click();
 const lunch=card.locator('[data-date="2026-10-15"] [data-meal-slot="0"]');
 const dinner=card.locator('[data-date="2026-10-15"] [data-meal-slot="1"]');
 await lunch.locator('input').fill('3');
 await dinner.locator('input').fill('5');
 await page.evaluate(()=>{state.revision++;return card.load();});
 await lunch.locator('[type="submit"]').click();
 assert.match(await card.locator('#error').innerText(),/Revisionskonflikt/);
 assert.equal(await lunch.locator('input').inputValue(),'3');
 await card.locator('[data-act="reload-plan"]').click();
 assert.equal(await lunch.locator('input').inputValue(),'2');
 await lunch.locator('input').fill('3');await dinner.locator('input').fill('5');
 await lunch.locator('[type="submit"]').click();
 assert.equal(await dinner.locator('input').inputValue(),'5');
 await dinner.locator('[type="submit"]').click();
 assert.equal(await card.locator('#error').innerText(),'');
 assert(await page.evaluate(()=>state.plan['2026-10-15'][0].servings==='3'&&state.plan['2026-10-15'][1].servings==='5'));
 await lunch.locator('select').selectOption('');await lunch.locator('[type="submit"]').click();
 assert(await page.evaluate(()=>state.plan['2026-10-15'][0]===null&&state.plan['2026-10-15'][1].recipe_id==='salad'));
 await dinner.locator('[data-detail]').click();assert.equal(await card.locator('h2').innerText(),'Salat');
 // Slot identity survives a separate dashboard route and a newly created card.
 await page.evaluate(()=>{card.setConfig({mode:'today',detail_path:'/lovelace/rezept'});card._mode='today';card.render();});
 await card.locator('#today-1').click();assert.match(page.url(),/meal_date=2026-10-15&meal_slot=1$/);
 await page.evaluate(()=>{card.remove();const next=document.createElement('essensplan-card');next.setConfig({mode:'detail'});document.querySelector('main').append(next);next.hass=hass;window.card=next;});
 await card.locator('h2').waitFor();assert.equal(await card.locator('h2').innerText(),'Salat');
 // Reducing the count keeps an occupied additional slot visible; saving errors retain drafts.
 await page.evaluate(()=>{state.meals_per_day=1;card.data=structuredClone(state);card._mode='week';card.render();});
 assert.equal(await card.locator('[data-date="2026-10-15"] form').count(),2);
 await dinner.locator('input').fill('7');await page.evaluate(()=>window.rejectMeal=true);
 await dinner.locator('[type="submit"]').click();
 assert.match(await card.locator('#error').innerText(),/Speichern fehlgeschlagen/);
 assert.equal(await dinner.locator('input').inputValue(),'7');
 await page.evaluate(()=>window.rejectMeal=false);await dinner.locator('[type="submit"]').click();
 assert.equal(await card.locator('#error').innerText(),'');
 // Background updates refresh clean weekly rows while keeping unsaved drafts.
 await page.evaluate(()=>{state.plan['2026-10-16']=[{recipe_id:'salad',servings:'9'}];state.revision++;card._isInteracting=false;return card.load();});
 assert.equal(await card.locator('[data-date="2026-10-16"] [data-meal-slot="0"] input').inputValue(),'9');
 // Mobile widths must not overflow horizontally.
 await page.setViewportSize({width:375,height:812});
 await page.evaluate(()=>{card._mode='week';card.render();});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 // Simulate HA mounting the view selected by its URL router.
 await page.evaluate(()=>{
  const paths={today:'/essensplan-plan/heute',week:'/essensplan-plan/woche',
   recipes:'/essensplan-plan/rezepte',shopping:'/essensplan-plan/einkauf',detail:'/essensplan-plan/rezept'};
  const show=()=>{
   const mode=Object.keys(paths).find(key=>paths[key]===location.pathname);
   if (!mode) return;
   card.remove();
   const next=document.createElement('essensplan-card');
   next.setConfig({mode,view_paths:paths});
   document.querySelector('main').append(next);next.hass=hass;window.card=next;
  };
  window.addEventListener('location-changed',show);
  window.addEventListener('popstate',show);
  history.replaceState(null,'',paths.today);
  show();
 });
 await card.locator('[data-mode="recipes"]').click();
 assert.match(page.url(),/\/essensplan-plan\/rezepte$/);
 await card.locator('[data-mode="recipes"][aria-current=page]').waitFor();
 await card.locator('[data-mode="week"]').click();
 assert.match(page.url(),/\/essensplan-plan\/woche$/);
 await card.locator('[data-act="shopping-week"]').click();
 assert.match(page.url(),/\/essensplan-plan\/einkauf$/);
 await card.locator('[data-mode="shopping"][aria-current=page]').waitFor();
 await page.goBack();
 await card.locator('[data-mode="week"][aria-current=page]').waitFor();
 assert.deepEqual(errors,[]);
 console.log('PASS: tap, long press, week, scaled ingredients, recipe creation, checklist, escaping; two meals, independent saves, draft and conflict protection, remove one slot, slot-specific detail URLs, retained meals after reducing count, failed save/retry, mobile width.');
 } finally { await browser.close(); }
})().catch(err=>{console.error(err);process.exitCode=1;});
