// DOM behavior checks without a rendering engine. This does NOT establish visual correctness.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { Window } = await import(process.env.HAPPY_DOM_PATH ? pathToFileURL(process.env.HAPPY_DOM_PATH).href : 'happy-dom');
const root = path.resolve(import.meta.dirname, '../..');
const script=fs.readFileSync(path.join(root,'web/cinema.js'),'utf8');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'web/cinema-catalog.json')));
let round=null, players=new Map(), fail=false, pinFail=false, launched=null;
function api(action,body={}){
  if(pinFail) return Promise.reject(new Error('pin'));
  const id=body.client||'';
  if(action==='join'){
    if(players.size>=2&&!players.has(id))return {ok:false,error:'У кімнаті вже двоє.'};
    round=round||'round-1'; if(!players.has(id))players.set(id,{name:body.name,votes:{}});
  }
  if(action==='vote'){
    if(fail){fail=false;return {ok:false,error:'Повторіть спробу.'};}
    if(body.round!==round)return {ok:false,error:'Вечір змінився.'};
    players.get(id).votes[body.id]=body.yes;
  }
  if(action==='reset'){round=null;players.clear();}
  const matches=catalog.filter(f=>players.size===2&&[...players.values()].every(p=>p.votes[f.id]===true)).map(f=>f.id);
  if(action==='play'){assert(matches.includes(body.id));launched=body.id;}
  return structuredClone({ok:true,round,names:[...players.values()].map(p=>p.name),progress:[...players.values()].map(p=>Object.keys(p.votes).length),matches,mine:players.get(id)?.votes||{},joined:players.has(id),catalog});
}
const windows=[];
function make(phone=true){
  const w=new Window({url:'http://tvhome.test/?cinema=1',settings:{disableJavaScriptFileLoading:true,disableCSSFileLoading:true}});windows.push(w);
  w.document.body.innerHTML=phone?'<div class="wrap"><div class="top"></div><div class="who"></div></div><div id="pinbox"></div>':'<div id="stage"><main>Home</main></div>';
  if(phone){w.cinemaAutoOpen=true;w.cinemaName=()=> 'Глядач';w.cinemaApi=(url,options)=>{
    const u=new URL(url,'http://x/');
    return Promise.resolve(api(u.pathname.split('/').pop(),options?.body?JSON.parse(options.body):{client:u.searchParams.get('client')}));
  };}else{w.TV={cinema:(action,body)=>JSON.stringify(api(action,JSON.parse(body))),remoteInfo:()=>JSON.stringify({url:'http://192.168.1.18:8765/?pin=000000',ip:'192.168.1.18',port:8765})};w.tvBack=()=>false;w.eval(fs.readFileSync(path.join(root,'web/vendor/qrcode.js'),'utf8'));}
  w.eval(script);return w;
}
async function flush(){for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));}
function click(w,key){const b=w.document.querySelector('[data-cn="'+key+'"]');assert(b,'button exists: '+key);b.click();}
function select(w,q){const e=w.document.querySelector(q);assert(e,q);return e;}
try{
  const one=make();await flush();
  select(one,'#cn-name').value='Євгеній';click(one,'join');await flush();
  assert(select(one,'.cn-film').dataset.film==='157336');
  fail=true;click(one,'yes:157336');await flush();
  assert.match(select(one,'.cn-notice').textContent,/Повторіть/);assert(!select(one,'[data-cn="yes:157336"]').disabled);
  assert(select(one,'.cn-film').dataset.film==='157336');
  const two=make();await flush();const draft=select(two,'#cn-name');draft.value='Моє незбережене ім’я';draft.focus();
  click(one,'yes:157336');await flush();assert.equal(api('state').matches.length,0);
  await new Promise(resolve=>setTimeout(resolve,1600));await flush();
  assert.equal(select(two,'#cn-name'),draft,'input node preserved when another participant votes');
  assert.equal(draft.value,'Моє незбережене ім’я');assert.equal(two.document.activeElement,draft);
  draft.value='Олена';click(two,'join');await flush();click(two,'yes:157336');await flush();
  assert.deepEqual(api('state').matches,['157336']);assert.deepEqual(api('state').mine,{});
  assert(select(two,'.cn-match').textContent.includes('Інтерстеллар'));
  const tv=make(false);tv.Cinema.openTV();await flush();
  assert(select(tv,'.cn-qr'));assert(select(tv,'.cn-match'));
  assert(select(tv,'main').inert,'background TV disabled for modal');
  tv.dispatchEvent(new tv.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
  assert.equal(tv.document.activeElement.dataset.cn,'play:157336');
  click(two,'play:157336');await flush();assert.equal(launched,'157336');
  click(one,'undo');click(one,'no:157336');await flush();assert.equal(api('state').matches.length,0);
  click(one,'undo');click(one,'yes:157336');await flush();assert.equal(api('state').matches.length,1);
  click(one,'close');assert(!one.document.querySelector('.cn-panel'));
  assert.equal(select(one,'#pinbox').inert,false);
  one.document.querySelector('.cn-entry').click();await flush();assert(select(one,'.cn-film').dataset.film==='120467','reopen resumes next film');assert.equal(players.size,2);
  const third=make();await flush();assert(select(third,'[data-cn="join"]').disabled);assert.equal(players.size,2);
  pinFail=true;
  const stale=make();await flush();assert(!stale.document.querySelector('.cn-panel'),'cinema yields to PIN recovery');assert.equal(select(stale,'#pinbox').inert,false);
  pinFail=false;stale.Cinema.pinReady();await flush();assert(select(stale,'.cn-panel'),'reopen after entering correct PIN');
  click(tv,'reset');assert.equal(players.size,2,'reset needs confirmation');click(tv,'reset-cancel');assert.equal(players.size,2);
  click(tv,'reset');click(tv,'reset-confirm');await flush();assert.equal(players.size,0);
  assert(tv.tvBack());assert(!tv.document.querySelector('.cn-panel'));assert.equal(select(tv,'main').inert,false);assert.equal(tv.tvBack(),false);
  one.localStorage.setItem('tv-world-motion','0');one.Cinema.motion();assert(one.document.body.classList.contains('world-still'));
  const sceneWindow=new Window();windows.push(sceneWindow);sceneWindow.document.body.innerHTML='<div id="scene"></div>';
  sceneWindow.eval(fs.readFileSync(path.join(root,'web/scene.js'),'utf8'));
  for(const name of ['kyiv','carpathians','orbit']){
    sceneWindow.Scene.world(sceneWindow.document.getElementById('scene'),name,'night');
    assert(select(sceneWindow,'.world-image').getAttribute('src')==='worlds/'+name+'.webp');
    assert(fs.existsSync(path.join(root,'web/worlds',name+'.webp')));
    const old=select(sceneWindow,'.world-image');sceneWindow.Scene.world(select(sceneWindow,'#scene'),name,'day');
    assert.equal(old,select(sceneWindow,'.world-image'),'phase change reuses bitmap');
    assert.equal(select(sceneWindow,'#scene').dataset.light,'day');
  }
  assert.equal(new Set(catalog.map(f=>f.id)).size,catalog.length);assert.equal(catalog.length,24);
  for(const f of catalog){assert(/^\d+$/.test(f.id));assert(f.title&&f.description&&f.minutes>0);}
  console.log('DOM behavior passed: private selection UI, two phones, name/focus retention, error retry, match, undo, reconnect, third viewer, PIN recovery, reset confirmation, TV navigation/back, motion preference, 3 scene assets, 24 unique films. No visual/layout claims.');
}finally{await Promise.all(windows.map(w=>w.happyDOM.abort()));}
