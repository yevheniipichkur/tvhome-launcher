// DOM behavior checks without a rendering engine. This does NOT establish visual correctness.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { Window } = await import(process.env.HAPPY_DOM_PATH ? pathToFileURL(process.env.HAPPY_DOM_PATH).href : 'happy-dom');
const root = path.resolve(import.meta.dirname, '../..');
const script=fs.readFileSync(path.join(root,'web/cinema.js'),'utf8');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'web/cinema-catalog.json')));
let round=null, players=new Map(), fail=false, pinFail=false, launched=null, playFail=false;
let dynamic=false, dynLoading=false, dynFilters=null, extraFilms=[];
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
  if(action==='configure'){assert.equal(round,null);dynFilters=body.filters;dynLoading=true;}
  if(action==='more'){extraFilms=[{id:'999999',title:'Новий фільм',year:2025,genre:'Бойовик',description:'Нова сторінка',poster:'',rating:8.2,votes:1000,minutes:null}];}

  const matches=catalog.filter(f=>players.size===2&&[...players.values()].every(p=>p.votes[f.id]===true)).map(f=>f.id);
  if(action==='play'){if(playFail)return {ok:false,error:'Lampa не встановлена'};assert(matches.includes(body.id));launched=body.id;}
  const out={ok:true,round,names:[...players.values()].map(p=>p.name),progress:[...players.values()].map(p=>Object.keys(p.votes).length),matches,mine:players.get(id)?.votes||{},joined:players.has(id),catalog};
  if(dynamic){out.filters=dynFilters;out.genres=[{id:0,name:'Усі жанри'},{id:28,name:'Бойовик'},{id:35,name:'Комедія'}];out.catalogMeta={source:'tmdb',cached:false,updatedAt:Date.now(),loading:dynLoading,error:'',hasMore:!extraFilms.length};out.catalog=catalog.concat(extraFilms).map(f=>({...f,minutes:null,rating:8.2,votes:1000}));}
  return structuredClone(out);
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
  // New online controls: loading, shared filters, frozen ballots and appended pages.
  dynamic=true;dynLoading=true;dynFilters={genre:0,fromYear:1900,toYear:new Date().getFullYear(),rating:0,sort:'popularity.desc'};
  const online=make();await flush();assert(select(online,'[data-cn="join"]').disabled,'wait for first online batch');
  dynLoading=false;online.document.dispatchEvent(new online.Event('visibilitychange'));await flush();
  click(online,'filter:genre');click(online,'pick-filter:1');
  click(online,'filter:rating');click(online,'pick-filter:3');
  click(online,'apply-filters');await flush();
  assert.equal(dynFilters.genre,28);assert.equal(dynFilters.rating,7);assert(select(online,'[data-cn="join"]').disabled);
  dynLoading=false;online.document.dispatchEvent(new online.Event('visibilitychange'));await flush();
  select(online,'#cn-name').value='Online viewer';click(online,'join');await flush();
  assert.equal(online.document.querySelectorAll('.cn-filter').length,0,'shared filters locked after joining');
  assert(select(online,'.cn-meta').textContent.includes('TMDB 8.2 / 10'));
  assert(!select(online,'.cn-meta').textContent.includes('null'),'runtime is never fabricated');
  for(const player of players.values())for(const f of catalog)player.votes[f.id]=false;
  online.document.dispatchEvent(new online.Event('visibilitychange'));await flush();
  click(online,'more');await flush();assert.equal(select(online,'.cn-film').dataset.film,'999999','new page extends shared deck');
  assert(Object.keys([...players.values()][0].votes).length===24,'old ballots preserved during load more');
  click(online,'close');api('reset');dynamic=false;
  // TV match reveal: fresh only, stable under polling, accurate revocation and two-button focus.
  const celebrate=make(false);celebrate.Cinema.openTV();await flush();
  const sync=async()=>{celebrate.document.dispatchEvent(new celebrate.Event('visibilitychange'));await flush();};
  const ballot=(id,yes=true)=>{for(const client of ['aaaaaaaaaaaaaaaaaaaa','bbbbbbbbbbbbbbbbbbbb'])api('vote',{client,round,id,yes});};
  api('join',{client:'aaaaaaaaaaaaaaaaaaaa',name:'Євгеній'});api('join',{client:'bbbbbbbbbbbbbbbbbbbb',name:'Олена'});
  ballot('157336');await sync();
  const reveal=select(celebrate,'.cn-celebration');
  assert(select(celebrate,'#cn-celebration-title').textContent.includes('Інтерстеллар'));
  assert.equal(celebrate.document.activeElement.dataset.cn,'celebrate-continue','safe initial focus');
  assert(select(celebrate,'.cn-shell').inert);assert.equal(select(celebrate,'.cn-panel').getAttribute('aria-labelledby'),'cn-celebration-title');
  await sync();assert.equal(select(celebrate,'.cn-celebration'),reveal,'poll does not remount or restart animation');
  const poster=select(celebrate,'.cn-celebration-poster img');poster.dispatchEvent(new celebrate.Event('error'));assert(poster.hidden,'missing poster falls back to film symbol');
  ballot('120467');await sync();assert.equal(select(celebrate,'.cn-celebration'),reveal,'another match does not replace the film being read');
  assert(select(celebrate,'.cn-celebration-extra').textContent.includes('1'));
  celebrate.dispatchEvent(new celebrate.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
  assert.equal(celebrate.document.activeElement.dataset.cn,'celebrate-play:157336','D-pad remains inside reveal actions');
  assert(celebrate.tvBack());assert(celebrate.tvBack()); // rapid repeated Back must not cancel cleanup.
  await new Promise(resolve=>setTimeout(resolve,250));await flush();
  assert(!celebrate.document.querySelector('.cn-celebration'));assert(select(celebrate,'.cn-panel'));assert.equal(select(celebrate,'.cn-shell').inert,false);
  await sync();assert(!celebrate.document.querySelector('.cn-celebration'),'dismissed matches do not replay');
  ballot('157336',false);await sync();ballot('157336');await sync();assert(!celebrate.document.querySelector('.cn-celebration'),'undo/revote does not replay a seen film');
  ballot('313369');await sync();assert(select(celebrate,'.cn-celebration'));ballot('313369',false);await sync();
  assert(!celebrate.document.querySelector('.cn-celebration'),'revoked match immediately leaves reveal');
  ballot('77338');await sync();assert(select(celebrate,'.cn-celebration-placeholder'));
  assert(!celebrate.document.querySelector('.cn-celebration img'),'posterless match remains usable');
  playFail=true;click(celebrate,'celebrate-play:77338');await flush();assert(select(celebrate,'.cn-celebration-notice').textContent.includes('Lampa не встановлена'));
  assert(!select(celebrate,'[data-cn="celebrate-continue"]').disabled,'failed launch leaves controls usable');
  playFail=false;click(celebrate,'celebrate-play:77338');await flush();assert.equal(launched,'77338');assert(!celebrate.document.querySelector('.cn-celebration'));
  click(celebrate,'close');celebrate.Cinema.openTV();await flush();assert(!celebrate.document.querySelector('.cn-celebration'),'reopening skips historical matches');
  api('reset');await sync();api('join',{client:'aaaaaaaaaaaaaaaaaaaa',name:'A'});api('join',{client:'bbbbbbbbbbbbbbbbbbbb',name:'B'});ballot('157336');await sync();
  assert(select(celebrate,'.cn-celebration'),'same film can celebrate in a new room');
  api('reset');await sync();assert(!celebrate.document.querySelector('.cn-celebration'),'room reset cancels reveal');
  assert(celebrate.document.activeElement.isConnected && celebrate.document.activeElement.tagName==='BUTTON' && select(celebrate,'.cn-shell').contains(celebrate.document.activeElement),'reset restores focus to a room button');
  click(celebrate,'close');
  // Regression: the actual home screen must expose the entry before even a very long app shelf.
  const home = new Window({url:'http://tvhome.test/',settings:{disableJavaScriptFileLoading:true,disableCSSFileLoading:true}});windows.push(home);
  home.document.body.innerHTML=fs.readFileSync(path.join(root,'web/index.html'),'utf8').match(/<body[^>]*>([\s\S]*)<\/body>/)[1];
  const manyApps=Array.from({length:20},(_,i)=>({pkg:'test.app.'+i,label:'App '+i,tv:true}));
  home.TV_CONFIG={favorites:manyApps.map(a=>a.pkg),hidden:[]};
  home.TV={apps:()=>JSON.stringify(manyApps),appsVersion:()=>1,watchNext:()=> '[]',media:()=> '{}',wifi:()=>'{"type":"wifi","level":3}',isLite:()=>true,updateInfo:()=> '{}',isDefaultHome:()=>true,a11yEnabled:()=>true,launch:()=>{},sound:()=>{}};
  home.XMLHttpRequest=class {open(){}send(){}setRequestHeader(){}};
  home.fetch=()=>Promise.reject(new Error('offline fixture'));
  home.eval(fs.readFileSync(path.join(root,'web/app.js'),'utf8'));
  const entry=select(home,'#track').firstElementChild;
  assert.equal(entry.dataset.action,'cinema','cinema is before all 20 favorite apps');
  assert.equal(entry.querySelector('.cinema-label').textContent,'Кіновечір');
  assert.equal(select(home,'#track').querySelectorAll('[data-action="cinema"]').length,1,'no duplicate icon at end');
  let openings=0;home.Cinema={openTV:()=>openings++};entry.click();assert.equal(openings,1);
  home.TVC={sysHidden:()=>true};home.TVH.buildDock();assert.equal(select(home,'#track').firstElementChild.dataset.action,'cinema','hidden system shortcuts do not hide cinema');
  home.eval(fs.readFileSync(path.join(root,'web/setup.js'),'utf8'));
  home.TVS.open();
  const key=k=>home.dispatchEvent(new home.KeyboardEvent('keydown',{key:k,bubbles:true}));
  for(let i=0;i<4;i++)key('ArrowDown');key('ArrowRight');
  assert(select(home,'.sv-row.focus').textContent.includes('Кіновечір удвох'),'settings > phone exposes movie night');
  key('Enter');assert.equal(openings,2,'settings shortcut opens cinema');
  console.log('DOM behavior passed: private selection UI, two phones, name/focus retention, error retry, match, undo, reconnect, third viewer, PIN recovery, reset confirmation, TV navigation/back, motion preference, 3 scene assets, 24 unique films. No visual/layout claims.');
}finally{await Promise.all(windows.map(w=>w.happyDOM.abort()));}
