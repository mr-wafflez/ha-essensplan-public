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
  if (!/^(recipe-ocr\.mjs|barcode\/(?:scanner\.mjs|zxing-browser\.min\.js)|ocr\/[a-z0-9.-]+)$/.test(name)) return route.fulfill({status:404,body:''});
  return route.fulfill({path:path.join(__dirname,'../custom_components/essensplan/frontend',name),
   contentType:/\.m?js$/.test(name)?'text/javascript':'application/octet-stream'});
 });
 await page.goto('http://essensplan.test/');
 await page.addScriptTag({path:path.join(__dirname,'../custom_components/essensplan/frontend/essensplan-card.js')});
 await page.evaluate(()=>{
  window.state={today:'2026-10-15',revision:0,completed:[],shopping_week:'2026-10-12',shopping:[{uid:'s1',summary:'500 g Hähnchen',completed:false}],
   recipes:{r1:{id:'r1',name:'Hähnchen-Curry <sicher>',servings:'4',image:'',ingredients:[{quantity:'500',unit:'g',name:'Hähnchen'}],steps:['Hähnchen würfeln.','Mit Kokosmilch garen.']}},plan:{'2026-10-15':{recipe_id:'r1',servings:'2'}}};
  window.calls=[];
  window.hass={states:{},callWS:async cmd=>{calls.push(cmd);
  if(cmd.type==='essensplan/barcode_lookup') return {product:{barcode:cmd.barcode,name:'Testprodukt',basis:'100g'},
   values:{kcal:'539',protein:'6.3',carbs:'57.5',fat:'30.9'}};
  if(cmd.type==='essensplan/product_search') return [{barcode:'4056489116066',name:'Hackfleisch gemischt · Landjunker',quantity:'500 g',kcal:234}];
  if(cmd.type==='essensplan/nutrition_search') return cmd.queries.map(()=>[{code:'A1',name:'Hähnchen Brust, roh'}]);
  if(cmd.type==='essensplan/change'){
   if(cmd.revision!==state.revision)throw Error('Revisionskonflikt');
   if(cmd.operation==='save_recipe'){const r=cmd.payload;state.recipes[r.id||'new']={...r,id:r.id||'new'};}
   if(cmd.operation==='set_ingredients'||cmd.operation==='save_amounts'){
    for(const raw of cmd.payload.items&&cmd.operation==='set_ingredients'?cmd.payload.items:cmd.payload.ingredients||[]){
     const entry=state.ingredient_list.find(e=>e.name===raw.name);
     Object.assign(entry,{nutrition:raw.nutrition,status:raw.ignore?'ignored':raw.nutrition?'mapped':'open',ignore:raw.ignore,
      label:raw.nutrition?.product?.name||'Hähnchen Brust, roh'});
     for(const [unit,grams] of Object.entries(raw.weights||{})) entry.weights[unit]={grams,source:'own'};
    }
    if(cmd.operation==='save_amounts') state.recipes[cmd.payload.id].ingredients.forEach((item,i)=>{
     item.quantity=cmd.payload.items[i].quantity||null;item.unit=cmd.payload.items[i].unit;});
    const done=cmd.operation==='save_amounts';
    state.nutrition={r1:{used:done?2:1,missing:done?[]:['Zwiebel'],items:[{name:'Hähnchen',status:'ok'},{name:'Zwiebel',status:done?'ok':'amount'},{name:'Salz',status:'ignored'}],
     portion:{kcal:125,protein:20,carbs:1,fat:3},total:{kcal:500,protein:80,carbs:4,fat:12}}};
   }
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
 assert.equal(await card.locator('nav [data-mode]').count(),4);
 assert.equal(await card.locator('nav [data-mode="today"]').getAttribute('aria-current'),'page');
 assert.equal(await card.locator('[data-act="week"]').count(),0);
 await card.locator('#today').click();
 assert.equal(await card.locator('h2').innerText(),'Hähnchen-Curry <sicher>');
 assert.match(await card.locator('ul').innerText(),/250 g Hähnchen/);
 assert.equal(await card.locator('nav [data-mode="today"]').getAttribute('aria-current'),'page');
 await card.locator('[data-back]').click();
 await card.locator('#today').waitFor();
 await card.locator('#today').click();
 await card.locator('[data-mode="today"]').click();
 const box=await card.locator('#today').boundingBox();
 await page.mouse.move(box.x+20,box.y+20);await page.mouse.down();await page.waitForTimeout(700);await page.mouse.up();
 assert.equal(await card.locator('h2').innerText(),'Wochenplan');
 assert.equal(await card.locator('nav [data-mode="week"]').getAttribute('aria-current'),'page');
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
 // Three local pages can be reordered, overlap only once, and add only the preparation.
 const pagePng=async (name, lines)=>({
  name,mimeType:'image/png',buffer:Buffer.from(await page.evaluate(lines=>{
   const c=document.createElement('canvas');c.width=940;c.height=440;const ctx=c.getContext('2d');
   ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='black';ctx.font='32px Arial';
   lines.forEach((line,i)=>ctx.fillText(line,46,65+i*55));
   return c.toDataURL('image/png').split(',')[1];
  },lines),'base64')
 });
 const pages=await Promise.all([
  pagePng('1.png',['Zutaten:','500 g Kartoffeln','100 g Butter']),
  pagePng('2.png',['100 g Butter','200 g Mehl','Zubereitung:','1. Kartoffeln kochen.','2. Milch erhitzen.']),
  pagePng('3.png',['2. Milch erhitzen.','3. Alles gut mischen.','Speichern und teilen','Nicht Teil des Rezepts.']),
 ]);

 const savedRecipe=await page.evaluate(()=>JSON.stringify(state.recipes.r1));
 await page.evaluate(()=>{
  const generic={el:{grams:'10',source:'generic'},tl:{grams:'4',source:'generic'},prise:{grams:'0.3',source:'generic'},ml:{grams:'1',source:'generic'}};
  const entry=(key,name,extra)=>({key,name,recipes:1,units:[],unmeasured:0,status:'open',ignore:false,ignore_default:false,
   nutrition:null,label:'',weights:structuredClone(generic),defaults:structuredClone(generic),...extra});
  state.recipes.r1.ingredients.push({name:'Zwiebel',quantity:null,unit:''},{name:'Salz',quantity:null,unit:''});
  state.ingredient_list=[entry('hahnchen','Hähnchen',{units:['g']}),entry('zwiebel','Zwiebel',{unmeasured:1}),
   entry('salz','Salz',{status:'ignored',ignore:true,ignore_default:true,unmeasured:1})];
  state.nutrition={r1:{used:0,missing:['Hähnchen','Zwiebel'],items:[{name:'Hähnchen',status:'mapping'},{name:'Zwiebel',status:'amount'},{name:'Salz',status:'ignored'}],
   portion:{kcal:0,protein:0,carbs:0,fat:0},total:{kcal:0,protein:0,carbs:0,fat:0}}};
  state.modules={nutrition:true};return card.load();
 });
 assert.match(await card.locator('[data-recipe-card="r1"]').innerText(),/noch nicht berechenbar · 2 Zutaten offen/);
 // The household ingredient list: one row per ingredient, suggestions, spices hidden under "Offen".
 await card.locator('[data-ingredients]').click();
 const nutritionDialog=card.locator('dialog');
 await nutritionDialog.getByText('Vorschlag: Hähnchen Brust, roh',{exact:false}).first().waitFor();
 assert.match(await nutritionDialog.locator('[data-summary]').innerText(),/0 von 3 Zutaten zugeordnet · 1 zählen nicht · 2 offen/);
 assert.equal(await nutritionDialog.locator('.ing-row').count(),2);
 await nutritionDialog.locator('[data-filter="all"]').click();
 assert.match(await nutritionDialog.locator('.ing-row[data-key="salz"]').innerText(),/Zählt nicht/);
 const chicken=nutritionDialog.locator('.ing-row[data-key="hahnchen"]');
 await chicken.locator('[data-edit]').click();
 const panel=chicken.locator('.ing-panel');
 assert(await panel.locator('input[type=radio][value="A1"]').isChecked());
 await panel.getByText('Eigene Werte oder Barcode').click();
 // A genuine EAN-13 image goes through the bundled decoder, then requires an explicit lookup.
 const barcodeImage=await page.evaluate(()=>{
  const code='3017620422003', left=['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
  const parity='LLGGGL';
  const invert=bits=>bits.replace(/./g,bit=>bit==='1'?'0':'1');
  const bits='101'+[...code.slice(1,7)].map((digit,i)=>parity[i]==='L'?left[digit]:[...invert(left[digit])].reverse().join('')).join('')
    +'01010'+[...code.slice(7)].map(digit=>invert(left[digit])).join('')+'101';
  const canvas=document.createElement('canvas');canvas.width=460;canvas.height=180;
  const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,460,180);
  ctx.fillStyle='black';[...bits].forEach((bit,i)=>{if(bit==='1')ctx.fillRect(40+i*4,16,4,140);});
  return canvas.toDataURL('image/png').split(',')[1];
 });
 const photoButton=panel.getByRole('button',{name:'Barcode fotografieren'});
 const chooserEvent=page.waitForEvent('filechooser');
 await photoButton.click();
 const chooser=await chooserEvent;
 assert.equal(await chooser.element().getAttribute('capture'),'environment');
 await chooser.setFiles({name:'barcode.png',mimeType:'image/png',buffer:Buffer.from(barcodeImage,'base64')});
 await panel.getByText('Barcode erkannt.',{exact:false}).waitFor();
 assert.equal(await panel.locator('[data-barcode]').inputValue(),'3017620422003');
 assert(await page.evaluate(()=>!calls.some(cmd=>cmd.type==='essensplan/barcode_lookup')));
 await panel.locator('[data-lookup]').click();
 await panel.getByText('Testprodukt gefunden.',{exact:false}).waitFor();
 assert.equal(await panel.locator('[name=kcal]').inputValue(),'539');
 assert(await panel.locator('input[type=radio][value="product"]').isChecked());
 await panel.locator('[data-apply]').click();
 assert.match(await chicken.innerText(),/✓ Testprodukt/);
 assert.equal(await nutritionDialog.locator('[data-save]').innerText(),'1 Änderung speichern');
 await nutritionDialog.locator('[data-save]').click();
 assert(await page.evaluate(()=>calls.some(cmd=>cmd.operation==='set_ingredients' &&
  cmd.payload.items[0].nutrition.product.barcode==='3017620422003' && cmd.payload.items[0].name==='Hähnchen')));
 await nutritionDialog.waitFor({state:'detached'});
 assert.match(await card.locator('[data-recipe-card="r1"]').innerText(),/unvollständig.*125 kcal/s);
 await card.locator('[data-recipe="r1"]').click();
 assert.match(await nutritionDialog.innerText(),/Gesamtgericht.*500 kcal.*Menge fehlt: Zwiebel/s);
 await nutritionDialog.locator('[data-close]').click();
 await nutritionDialog.waitFor({state:'detached'});
 // The secure-context permission failure path switches to a new, user-activated photo action.
 await page.evaluate(()=>Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{
  getUserMedia:()=>Promise.reject(new DOMException('Test permission denied','NotAllowedError'))
 }}));
 await card.locator('[data-ingredients]').click();
 await nutritionDialog.locator('.ing-row[data-key="zwiebel"] [data-edit]').click();
 await nutritionDialog.getByText('Eigene Werte oder Barcode').click();
 await nutritionDialog.getByRole('button',{name:'Barcode scannen'}).click();
 await nutritionDialog.getByText('Kamerazugriff verweigert.',{exact:false}).waitFor();
 const fallbackEvent=page.waitForEvent('filechooser');
 await nutritionDialog.getByRole('button',{name:'Barcode fotografieren'}).click();
 await (await fallbackEvent).setFiles([]);
 // Text search at Open Food Facts sends the term, then the chosen product goes through the barcode lookup.
 await nutritionDialog.locator('[data-products]').click();
 await nutritionDialog.locator('.product-choice').first().click();
 await nutritionDialog.getByText('Hackfleisch gemischt · Landjunker ausgewählt.').waitFor();
 assert(await nutritionDialog.locator('.ing-panel input[type=radio][value="product"]').isChecked());
 assert(await page.evaluate(()=>calls.some(c=>c.type==='essensplan/product_search' && c.query==='Zwiebel') &&
  calls.some(c=>c.type==='essensplan/barcode_lookup' && c.barcode==='4056489116066')));
 await nutritionDialog.locator('[data-close]').click();
 await nutritionDialog.waitFor({state:'detached'});
 await page.evaluate(()=>delete navigator.mediaDevices);
 // Amounts table: typing keeps focus, a piece needs a weight, one save sends amounts and the list entry.
 await card.locator('[data-amounts="r1"]').click();
 const amountRows=nutritionDialog.locator('.amount-row');
 await amountRows.nth(1).getByText('Menge fehlt').waitFor();
 assert.match(await amountRows.nth(0).innerText(),/✓ ≈ 500 g/);
 assert.match(await amountRows.nth(2).innerText(),/zählt nicht/);
 await amountRows.nth(1).locator('[data-qty]').pressSequentially('2');
 assert(await page.evaluate(()=>card.shadowRoot.activeElement?.matches('[data-qty]')));
 await amountRows.nth(1).locator('[data-unit]').selectOption('stück');
 assert.match(await amountRows.nth(1).innerText(),/Gewicht pro Stück fehlt/);
 await amountRows.nth(1).locator('[data-edit]').click();
 await amountRows.nth(1).locator('[data-weight="stück"]').fill('80');
 await amountRows.nth(1).locator('[data-apply]').click();
 assert.match(await amountRows.nth(1).innerText(),/✓ ≈ 160 g/);
 assert.match(await nutritionDialog.locator('[data-summary]').innerText(),/2 von 2 Zutaten vollständig · 1 zählen nicht · 1 Zuordnung neu/);
 await nutritionDialog.locator('[type=submit]').click();
 await nutritionDialog.waitFor({state:'detached'});
 const saved=await page.evaluate(()=>calls.findLast(cmd=>cmd.operation==='save_amounts').payload);
 assert.deepEqual(saved.items,[{quantity:'500',unit:'g'},{quantity:'2',unit:'stück'},{quantity:'',unit:''}]);
 assert.deepEqual(saved.ingredients.map(i=>[i.name,i.weights,i.nutrition?.code]),[['Zwiebel',{'stück':'80'},'A1']]);
 assert.match(await card.locator('[data-recipe-card="r1"]').innerText(),/Pro Portion\n125 kcal/);
 await page.evaluate(saved=>{state.recipes.r1=JSON.parse(saved);state.modules.nutrition=false;return card.load();},savedRecipe);
 assert.equal(await card.locator('[data-amounts]').count(),0);
 assert.equal(await card.locator('[data-ingredients]').count(),0);
 await card.locator('[data-act="new"]').click();
 await card.locator('#recipe-screenshot').setInputFiles([...pages,pages[0]]);
 assert.match(await card.locator('#ocr-status').innerText(),/höchstens drei/);
 await card.locator('#recipe-screenshot').setInputFiles([pages[1],pages[0],pages[2]]);
 await card.getByRole('button',{name:'Bild 2 nach oben'}).click();
 assert.match(await card.locator('#ocr-files li').first().innerText(),/^1.png/);
 await card.locator('#ocr-read').click();
 await card.locator('#ocr-review').waitFor({timeout:30000});
 assert.deepEqual((await card.locator('#ocr-text').inputValue()).split('\n'),['500 g Kartoffeln','100 g Butter','200 g Mehl']);
 assert.deepEqual((await card.locator('#ocr-steps').inputValue()).split('\n'),['Kartoffeln kochen.','Milch erhitzen.','Alles gut mischen.']);
 assert.equal(await card.locator('#ocr-step-images img').count(),2);
 assert.match(await card.locator('#ocr-step-hint').innerText(),/Fortsetzungen/);
 await card.locator('#steps').fill('Vorhandener Schritt.');
 const stepUrl=await card.locator('#ocr-step-images img').first().getAttribute('src');
 await card.locator('#apply-ocr-steps').click();
 assert.equal(await card.locator('#steps').inputValue(),'Vorhandener Schritt.\nKartoffeln kochen.\nMilch erhitzen.\nAlles gut mischen.');
 assert.equal(await card.locator('.ingredient-row [data-name]').first().inputValue(),'');
 assert(await page.evaluate(url=>fetch(url).then(()=>false,()=>true),stepUrl));
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
 await card.locator('#today').click();assert.match(page.url(),/\/lovelace\/rezept\?meal_date=2026-10-15&from=today$/);
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
 assert.equal(await card.locator('.slot').count(),14);
 assert.equal(await card.locator('form, select, input[type=number]').count(),0);
 const pick=card.locator('[data-slot-open="2026-10-16"][data-slot="1"]');
 const slotSheet=(date,slot)=>card.locator(`[data-slot-open="${date}"][data-slot="${slot}"]`);
 const sheet=card.locator('dialog');
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
 await slotSheet('2026-10-15',0).click();
 assert.match(await sheet.innerText(),/Hähnchen-Curry <sicher>/);
 await sheet.locator('[data-slot-action="edit"]').click();
 assert.equal(await card.locator('dialog').count(),1);
 assert.match(await card.locator('dialog h2').innerText(),/ändern/);
 await card.locator('#plan-cook').fill('6');
 await card.locator('dialog [type=submit]').click();
 await card.locator('dialog').waitFor({state:'hidden'});
 assert.match(await card.locator('[data-date="2026-10-15"]').innerText(),/4 Portionen noch nicht verplant/);
 await capture('mealprep',card.locator('[data-date="2026-10-15"]'));
 await slotSheet('2026-10-15',0).click();
 await sheet.locator('[data-slot-action="leftover"]').click();
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
 // Portions change in the schedule dialog; the cook portions and the cooked flag are kept.
 await slotSheet('2026-10-15',0).click();
 await sheet.locator('[data-slot-action="edit"]').click();
 await card.locator('#plan-servings').fill('3');
 // A background change invalidates the open dialog instead of silently overwriting it.
 await page.evaluate(()=>{state.revision++;return card.load();});
 await card.locator('dialog [type=submit]').click();
 assert.match(await card.locator('#dialog-error').innerText(),/Der Plan wurde geändert/);
 assert(await page.evaluate(()=>state.plan['2026-10-15'][0].servings==='2'));
 await card.locator('dialog [data-close]').click();
 await card.locator('dialog').waitFor({state:'detached'});
 await slotSheet('2026-10-15',0).click();
 await sheet.locator('[data-slot-action="edit"]').click();
 await card.locator('#plan-servings').fill('3');
 await card.locator('dialog [type=submit]').click();
 await card.locator('dialog').waitFor({state:'detached'});
 assert.equal(await card.locator('#error').innerText(),'');
 assert(await page.evaluate(()=>state.plan['2026-10-15'][0].servings==='3' &&
  state.plan['2026-10-15'][0].cook_servings==='6' && state.plan['2026-10-15'][1].servings==='6'));
 // Quick check button and the sheet share the same cooked toggle.
 await slotSheet('2026-10-15',1).click();
 await sheet.locator('[data-slot-action="cooked"]').click();
 assert(await page.evaluate(()=>state.plan['2026-10-15'][1].cooked===true));
 await card.locator('[data-cooked="2026-10-15"][data-slot="1"][aria-pressed=true]').click();
 assert(await page.evaluate(()=>!state.plan['2026-10-15'][1].cooked));
 // Replacing a recipe keeps the date and slot but starts from the new recipe's own defaults.
 await slotSheet('2026-10-15',1).click();
 await sheet.locator('[data-slot-action="replace"]').click();
 await sheet.locator('[data-pick="r1"]').click();
 assert.equal(await card.locator('#plan-date').inputValue(),'2026-10-15');
 assert.equal(await card.locator('#plan-servings').inputValue(),'4');
 assert.equal(await card.locator('#plan-cook').inputValue(),'');
 await card.locator('dialog [type=submit]').click();
 await card.locator('dialog').waitFor({state:'detached'});
 assert(await page.evaluate(()=>state.plan['2026-10-15'][1].recipe_id==='r1' && state.plan['2026-10-15'][1].servings==='4'));
 await slotSheet('2026-10-15',1).click();
 await sheet.locator('[data-slot-action="replace"]').click();
 await sheet.locator('[data-pick="salad"]').click();
 await card.locator('#plan-servings').fill('6');
 await card.locator('dialog [type=submit]').click();
 await card.locator('dialog').waitFor({state:'detached'});
 // Removing needs a second tap; a freed lunch never moves dinner.
 await slotSheet('2026-10-15',0).click();
 await sheet.locator('[data-slot-action="remove"]').click();
 assert.equal(await sheet.locator('[data-slot-action="remove"]').innerText(),'Wirklich entfernen?');
 assert(await page.evaluate(()=>state.plan['2026-10-15'][0]!==null));
 await sheet.locator('[data-slot-action="remove"]').click();
 await card.locator('dialog').waitFor({state:'detached'});
 assert(await page.evaluate(()=>state.plan['2026-10-15'][0]===null&&state.plan['2026-10-15'][1].recipe_id==='salad'));
 await slotSheet('2026-10-15',1).click();
 await sheet.locator('[data-slot-action="view"]').click();
 assert.equal(await card.locator('h2').innerText(),'Salat');
 await card.locator('[data-back]').click();
 assert.equal(await card.locator('h2').innerText(),'Wochenplan');
 // Slot identity survives a separate dashboard route and a newly created card.
 await page.evaluate(()=>{card.setConfig({mode:'today',detail_path:'/lovelace/rezept'});card._mode='today';card.render();});
 await card.locator('#today-1').click();assert.match(page.url(),/meal_date=2026-10-15&meal_slot=1&from=today$/);
 await page.evaluate(()=>{card.remove();const next=document.createElement('essensplan-card');next.setConfig({mode:'detail'});document.querySelector('main').append(next);next.hass=hass;window.card=next;});
 await card.locator('h2').waitFor();assert.equal(await card.locator('h2').innerText(),'Salat');
 // Reducing the count keeps an occupied additional slot visible; saving errors retain drafts.
 await page.evaluate(()=>{state.meals_per_day=1;card.data=structuredClone(state);card._mode='week';card.render();});
 assert.equal(await card.locator('[data-date="2026-10-15"] .slot').count(),2);
 await slotSheet('2026-10-15',1).click();
 await sheet.locator('[data-slot-action="edit"]').click();
 await card.locator('#plan-servings').fill('7');
 await page.evaluate(()=>window.rejectMeal=true);
 await card.locator('dialog [type=submit]').click();
 assert.match(await card.locator('#dialog-error').innerText(),/Speichern fehlgeschlagen/);
 assert.equal(await card.locator('#plan-servings').inputValue(),'7');
 await page.evaluate(()=>window.rejectMeal=false);
 await card.locator('dialog [type=submit]').click();
 await card.locator('dialog').waitFor({state:'detached'});
 assert.equal(await card.locator('#error').innerText(),'');
 assert(await page.evaluate(()=>state.plan['2026-10-15'][1].servings==='7'));
 // Background updates refresh the week tiles.
 await page.evaluate(()=>{state.plan['2026-10-16']=[{recipe_id:'salad',servings:'9'}];state.revision++;card._isInteracting=false;return card.load();});
 assert.match(await card.locator('[data-date="2026-10-16"]').innerText(),/Salat[\s\S]*9 Portionen/);
 // An empty slot on today's tile opens the recipe picker without a detour through the week.
 await page.evaluate(()=>{delete state.plan['2026-10-15'];state.revision++;card.setConfig({mode:'today'});return card.load();});
 await card.locator('#today').click();
 assert.match(await card.locator('dialog').innerText(),/Rezept auswählen/);
 await card.locator('dialog [data-close]').click();
 await card.locator('dialog').waitFor({state:'detached'});
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
 console.log('PASS: one navigation, back button, tap, long press, week tiles and action sheet, scaled ingredients, recipe creation, checklist, escaping; two meals, conflict protection, replace and remove one slot, slot-specific detail URLs with origin tab, retained meals after reducing count, failed save/retry, mobile width.');
 } finally { await browser.close(); }
})().catch(err=>{console.error(err);process.exitCode=1;});
