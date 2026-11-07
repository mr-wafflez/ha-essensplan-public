/* Unit tests for card rendering/actions, using a minimal DOM boundary. No browser. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../custom_components/essensplan/frontend/essensplan-card.js'),'utf8');
function makeCard(config={mode:'today'}) {
 let Klass;
 const tile={dataset:{todaySlot:'0'}},error={textContent:''};
 const root={innerHTML:'',querySelectorAll(selector){return selector==='[data-today-slot]' && this.innerHTML.includes('id="today"') ? [tile] : [];},querySelector(selector){
  if(selector==='#today' && this.innerHTML.includes('id="today"'))return tile;
  if(selector==='#error')return error;
  return null;
 }};
 const location={origin:'http://test.local',search:''};
 const events=[];
 const sandbox={HTMLElement:class{constructor(){this.isConnected=true;}attachShadow(){this.shadowRoot=root;}},
  customElements:{get:()=>false,define:(_,K)=>{Klass=K;}},window:{customCards:[],dispatchEvent:e=>events.push(e.type)},
  location,history:{pushState:(_s,_t,url)=>{location.url=url;location.search=new URL(url,location.origin).search;}},
  CustomEvent:class{constructor(type, options){this.type=type;this.detail=options.detail;}},URL,URLSearchParams,Intl,Date,setTimeout,clearTimeout};
 vm.runInNewContext(source,sandbox);
 const card=new Klass();card.setConfig(config);
 card.data={today:'2026-10-15',revision:0,recipes:{r1:{id:'r1',name:'Curry <b> & "',servings:'4',image:'',ingredients:[{quantity:'500',unit:'g',name:'Hähnchen'}],steps:['Schneiden <script>.','Garen.']}},
  plan:{'2026-10-15':{recipe_id:'r1',servings:'2'}},shopping:[],shopping_week:'2026-10-12'};
 card.render();
 return {card,root,tile,location,events};
}

test('recipe content is escaped and ingredients scale to planned portions',()=>{
 const {card,root,tile}=makeCard();assert(root.innerHTML.includes('Curry &lt;b&gt; &amp; &quot;'));
 tile.onclick();assert(root.innerHTML.includes('250 g Hähnchen'));assert(!root.innerHTML.includes('<script>'));
});
test('empty day opens weekly planner',()=>{
 const {card,root}=makeCard();card.data.plan={};card.render();root.querySelector('#today').onclick();
 assert.equal(card._mode,'week');assert(root.innerHTML.includes('Unser Wochenplan'));
});
test('long press opens week and a following click does not open recipe',async()=>{
 const {card,tile}=makeCard();tile.onpointerdown({button:0,clientX:0,clientY:0});
 await new Promise(r=>setTimeout(r,650));tile.onpointerup();tile.onclick();assert.equal(card._mode,'week');
});
test('scroll movement cancels long press and click navigation',async()=>{
 const {card,tile}=makeCard();tile.onpointerdown({button:0,clientX:0,clientY:0});
 tile.onpointermove({clientX:0,clientY:30});await new Promise(r=>setTimeout(r,650));tile.onpointerup();tile.onclick();
 assert.equal(card._mode,undefined);
});
test('configured navigation uses local URL, date query and HA event',()=>{
 const {tile,location,events}=makeCard({mode:'today',detail_path:'/essensplan/rezept',week_path:'/essensplan/woche'});
 tile.onclick();assert.equal(location.url,'/essensplan/rezept?meal_date=2026-10-15');assert(events.includes('location-changed'));
});
test('dashboard tabs use their own paths without changing the current card mode',()=>{
 const {card,location,events,root}=makeCard({mode:'week',view_paths:{
  today:'/essensplan/heute',week:'/essensplan/woche',recipes:'/essensplan/rezepte',shopping:'/essensplan/einkauf'}});
 assert(root.innerHTML.includes('data-mode="week" aria-current="page"'));
 for(const [mode,path] of [['recipes','rezepte'],['shopping','einkauf'],['today','heute'],['week','woche']]){
  card.navigate(mode);
  assert.equal(location.url,'/essensplan/'+path);
  assert.equal(card._mode,undefined);
 }
 assert.equal(events.filter(event=>event==='location-changed').length,4);
});
test('weekly rendering crosses year boundary and includes seven days',()=>{
 const {card}=makeCard();card.week='2026-12-28';const html=card.weekHTML();
 assert.equal((html.match(/class="day /g)||[]).length,7);assert(html.includes('data-date="2027-01-03"'));
});
test('configuration rejects external routes and unknown modes',()=>{
 for(const config of [{mode:'unknown'},{mode:'today',detail_path:'https://example.com'},{mode:'today',week_path:'//example.com'}])assert.throws(()=>makeCard(config));
});
test('explicit edit revision is preserved even after background data refresh',async()=>{
 const {card}=makeCard();let sent;
 card.data.revision=9;card._hass={callWS:async msg=>{sent=msg;return card.data;}};
 await card.change('save_recipe',{name:'Draft'},3);
 assert.equal(sent.revision,3);
});
