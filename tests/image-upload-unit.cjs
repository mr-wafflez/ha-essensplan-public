const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function setup({width=4000,height=3000,decodeFails=false}={}) {
  let Klass,canvas,request;
  const revoked=[];
  const context={fillRect(){},drawImage(){}};
  const sandbox={HTMLElement:class{},customElements:{get:()=>false,define:(_name,k)=>{Klass=k;}},
    window:{customCards:[]},Intl,Date,Blob,FormData,
    URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:url=>revoked.push(url)},
    Image:class{naturalWidth=width;naturalHeight=height;set src(_value){queueMicrotask(()=>decodeFails?this.onerror():this.onload());}},
    document:{createElement(){canvas={getContext:()=>context,toBlob(callback,type,quality){request={type,quality};callback(new Blob(['jpeg'],{type}));}};return canvas;}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../custom_components/essensplan/frontend/essensplan-card.js'),'utf8'),sandbox);
  const headers={'image/jpeg':[255,216,255],'image/png':[137,80,78,71,13,10,26,10],'image/webp':Buffer.from('RIFF0000WEBP')};
  const prepare=(type='image/png',size=1024,maxMB=20,header=headers[type])=>sandbox.prepareRecipeImage({type,size,slice:()=>new Blob([Uint8Array.from(header||[])] )},maxMB);
  return {prepare,card:()=>Object.create(Klass.prototype),revoked,canvas:()=>canvas,request:()=>request};
}
test('large photos become 1600px JPEGs and their source URL is released',async()=>{
  const s=setup();const blob=await s.prepare();
  assert.equal(blob.type,'image/jpeg');assert.equal(s.canvas().width,1600);assert.equal(s.canvas().height,1200);
  assert.deepEqual(s.request(),{type:'image/jpeg',quality:0.85});assert.deepEqual(s.revoked,['blob:test']);
});
test('portrait photos retain their aspect ratio and small images are not enlarged',async()=>{
  const portrait=setup({width:3000,height:4000});await portrait.prepare('image/jpeg');
  assert.equal(portrait.canvas().width,1200);assert.equal(portrait.canvas().height,1600);
  const small=setup({width:300,height:200});await small.prepare('image/webp');
  assert.equal(small.canvas().width,300);assert.equal(small.canvas().height,200);
});
test('unsupported, empty and oversized files are rejected before decoding',async()=>{
  const s=setup();
  await assert.rejects(s.prepare('image/svg+xml'),/JPEG/);
  await assert.rejects(s.prepare('image/png',0),/20 MB/);
  await assert.rejects(s.prepare('image/jpeg',21*1024*1024),/20 MB/);
  assert.deepEqual(s.revoked,[]);
  await assert.rejects(s.prepare('image/png',1024,20,[255,216,255]),/Dateiinhalt/);
  await assert.rejects(s.prepare('image/png',2*1024*1024,1),/1 MB/);
});
test('invalid image bytes and excessive pixel counts fail with clean object URLs',async()=>{
  const bad=setup({decodeFails:true});await assert.rejects(bad.prepare(),/geöffnet/);assert.equal(bad.revoked.length,1);
  const huge=setup({width:10000,height:10000});await assert.rejects(huge.prepare(),/Bildauflösung/);assert.equal(huge.revoked.length,1);
});
test('uploads use HA authenticated multipart and only accept confirmed image IDs',async()=>{
  const card=setup().card();let call;
  card._hass={fetchWithAuth:async(...args)=>{call=args;return {ok:true,status:200,json:async()=>({id:'ab'.repeat(16)})};}};
  assert.equal(await card.uploadImage(new Blob(['photo'],{type:'image/jpeg'})),'/api/image/serve/'+'ab'.repeat(16)+'/original');
  assert.equal(call[0],'/api/image/upload');assert.equal(call[1].method,'POST');
  assert.equal(call[1].body.get('file').name,'rezeptbild.jpg');
  card._hass.fetchWithAuth=async()=>({ok:true,status:200,json:async()=>({id:'../../config'})});
  await assert.rejects(card.uploadImage(new Blob(['photo'])),/nicht bestätigt/);
});
test('upload size, authentication and server failures remain actionable',async()=>{
  const card=setup().card();
  for(const [status,message] of [[413,/zu groß/],[401,/anmelden/],[403,/anmelden/],[500,/erneut versuchen/]]){
    card._hass={fetchWithAuth:async()=>({ok:false,status})};
    await assert.rejects(card.uploadImage(new Blob(['photo'])),message);
  }
});
