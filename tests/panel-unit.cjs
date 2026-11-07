const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../custom_components/essensplan/frontend/essensplan-panel.js'),'utf8').replace(/^import .*;$/m,'');

function panelFixture() {
  let Panel,card;
  const menu={},main={append(value){this.card=value;}};
  const root={querySelector:s=>s==='main'?main:menu};
  const sandbox={HTMLElement:class{attachShadow(){this.shadowRoot=root;}},
    document:{createElement(name){assert.equal(name,'essensplan-card');card={setConfig(config){this.config=config;}};return card;}},
    customElements:{get:()=>false,define:(_name,klass)=>{Panel=klass;}}};
  vm.runInNewContext(source,sandbox);
  return {panel:new Panel(),get card(){return card;},menu,main};
}
test('new sidebar opens the complete weekly planner',()=>{
  const f=panelFixture();assert.equal(f.card.config.mode,'week');assert.equal(f.main.card,f.card);
});
test('HA state updates retain the same card and draft DOM',()=>{
  const f=panelFixture(),original=f.card;
  const a={states:{},revision:1},b={states:{},revision:2};
  f.panel.hass=a;f.panel.hass=b;
  assert.equal(f.card,original);assert.equal(f.card.hass,b);assert.equal(f.menu.hass,b);assert.equal(f.panel.hass,b);
});
test('mobile panel forwards the sidebar menu layout',()=>{
  const f=panelFixture();f.panel.narrow=true;assert.equal(f.menu.narrow,true);
});
