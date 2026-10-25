/* Browser integration fixtures deliberately mock the Android bridge/HTTP layer.
 * The real synchronized room is exercised separately by CinemaRoomTest.java. */
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'web/cinema-catalog.json')));
const screenshots = path.join(root, '.impeccable/review');
let round = null, people = new Map(), launched = null, failVote = false;
function api(action, body = {}) {
  const id = body.client || '';
  if (action === 'join') {
    if (!people.has(id) && people.size === 2) return { ok:false, error:'У кімнаті вже двоє.' };
    if (!round) round = 'test-round-1';
    if (!people.has(id)) people.set(id,{name:body.name,votes:{}});
  }
  if (action === 'vote') {
    if (failVote) { failVote = false; return {ok:false,error:'Тестова помилка: спробуйте ще раз.'}; }
    assert.equal(body.round, round); assert(people.has(id));
    people.get(id).votes[body.id] = body.yes;
  }
  if (action === 'reset') { people.clear(); round = null; }
  const matches = catalog.filter(f=>people.size===2 && [...people.values()].every(p=>p.votes[f.id]===true)).map(f=>f.id);
  if (action === 'play') { assert(matches.includes(body.id)); launched=body.id; }
  return {ok:true,round,names:[...people.values()].map(p=>p.name),progress:[...people.values()].map(p=>Object.keys(p.votes).length),matches,mine:people.get(id)?.votes || {},joined:people.has(id),catalog};
}
async function serve(route) {
  const u = new URL(route.request().url());
  if(u.hostname !== 'tvhome.test') return route.fulfill({status:404,body:''});
  if(u.pathname.startsWith('/api/cinema/')) {
    const body = route.request().method()==='POST' ? route.request().postDataJSON() : {client:u.searchParams.get('client')};
    return route.fulfill({json:api(u.pathname.split('/').pop(),body)});
  }
  if(u.pathname==='/api/state') return route.fulfill({json:{model:'Тестова приставка',clients:[],city:'Львів',today:0,threats:[],updated:{},errors:{}}});
  if(u.pathname.startsWith('/api/')) return route.fulfill({json:{ok:true}});
  let f=path.join(root,'web',u.pathname==='/' ? 'remote.html' : u.pathname);
  if(!fs.existsSync(f) || !fs.statSync(f).isFile()) return route.fulfill({status:404,body:''});
  const ext=path.extname(f), mime={'.html':'text/html','.js':'application/javascript','.json':'application/json','.css':'text/css','.woff2':'font/woff2','.webp':'image/webp'};
  return route.fulfill({contentType:mime[ext]||'application/octet-stream',body:fs.readFileSync(f)});
}
(async()=>{
  fs.mkdirSync(screenshots,{recursive:true});
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const errors=[];
  async function context(width,height,native=false){
    const c=await browser.newContext({viewport:{width,height},deviceScaleFactor:1}); await c.route('**/*',serve);
    const p=await c.newPage(); p.on('pageerror',e=>errors.push(e.message));
    if(native){
      await p.exposeFunction('nativeCinema',(a,b)=>api(a,JSON.parse(b)));
      // Synchronous JavascriptInterface is represented with a state snapshot for rendering.
      await p.addInitScript(()=>{
        localStorage.setItem('tv-bg','kyiv'); localStorage.setItem('tv-wizard','1');
        window.TV={isLite:()=>true,isDefaultHome:()=>true,a11yEnabled:()=>true,apps:()=> '[]',appsVersion:()=>1,watchNext:()=> '[]',media:()=> '{}',wifi:()=>'{"type":"wifi","ssid":"Дім","level":3}',updateInfo:()=> '{}',volume:()=>'{"current":5,"max":15}',remoteInfo:()=>'{"url":"http://192.168.1.18:8765/?pin=000000","ip":"192.168.1.18","port":8765}',pref:()=>false,deviceInfo:()=> '{}',notchMap:()=>false,sound:()=>{},cinema:()=>JSON.stringify(window.testCinemaState)};
      });
    }
    return {c,p};
  }
  try {
    let {c:tvContext,p:tv}=await context(1920,1080,true);
    await tv.goto('http://tvhome.test/index.html?demo&phase=dusk');
    await tv.waitForFunction(()=>window.Cinema && window.TVH);
    await tv.evaluate(()=>document.body.classList.remove('intro'));
    for(const world of ['kyiv','carpathians','orbit']){
      await tv.evaluate(w=>{localStorage.setItem('tv-bg',w);Scene.world(document.getElementById('scene'),w,'dusk');},world);
      await tv.locator('.world-image').evaluate(img=>img.decode());
      await tv.screenshot({path:path.join(screenshots,'world-'+world+'.png')});
    }
    await tv.evaluate(s=>{window.testCinemaState=s;Cinema.openTV();},api('state'));
    await tv.locator('.cn-qr').waitFor();
    await tv.screenshot({path:path.join(screenshots,'tv-waiting.png')});
    await tv.keyboard.press('ArrowDown'); assert(await tv.locator('.cn-reset button').evaluate(b=>b===document.activeElement));
    await tv.keyboard.press('Escape'); assert.equal(await tv.locator('.cn-panel').count(),0);
    const {c:a,p:one}=await context(390,844);
    await one.goto('http://tvhome.test/?pin=000000&cinema=1');
    await one.locator('#cn-name').waitFor(); assert.equal(new URL(one.url()).searchParams.has('pin'),false);
    await one.screenshot({path:path.join(screenshots,'phone-invite.png')});
    await one.locator('#cn-name').fill('Євгеній'); await one.locator('[data-cn="join"]').click();
    await one.locator('[data-film="157336"]').waitFor();
    await one.screenshot({path:path.join(screenshots,'phone-card.png')});
    failVote=true; await one.locator('[data-cn="yes:157336"]').click();
    await one.getByText('Тестова помилка: спробуйте ще раз.').waitFor();
    assert.equal(await one.locator('[data-film="157336"]').count(),1);
    await one.locator('[data-cn="yes:157336"]').click(); await one.locator('[data-film="120467"]').waitFor();
    const {c:b,p:two}=await context(320,640);
    await two.goto('http://tvhome.test/?pin=000000&cinema=1'); await two.locator('#cn-name').fill('Олена'); await two.locator('[data-cn="join"]').click();
    await two.locator('[data-cn="yes:157336"]').click(); await two.locator('.cn-match').waitFor();
    assert.equal(api('state').matches[0],'157336'); assert.equal(Object.keys(api('state').mine).length,0);
    await two.screenshot({path:path.join(screenshots,'phone-small-match.png')});
    assert(await two.evaluate(()=>document.querySelector('.cn-panel').scrollWidth<=innerWidth));
    await one.reload(); await one.locator('[data-film="120467"]').waitFor(); assert.equal(people.size,2);
    await one.locator('[data-cn="undo"]').click(); await one.locator('[data-cn="no:157336"]').click(); await one.locator('[data-film="120467"]').waitFor();
    assert.equal(api('state').matches.length,0);
    await one.locator('[data-cn="undo"]').click(); await one.locator('[data-cn="yes:157336"]').click();
    await tv.evaluate(s=>{window.testCinemaState=s;Cinema.openTV();},api('state'));
    await tv.locator('.cn-match').waitFor(); await tv.screenshot({path:path.join(screenshots,'tv-match.png')});
    await two.locator('[data-cn="play:157336"]').click(); assert.equal(launched,'157336');
    for(const [id,p] of people) catalog.forEach(f=>p.votes[f.id]=false);
    await one.waitForTimeout(1700); await one.getByRole('heading',{name:'Ваш вибір готовий'}).waitFor();
    await one.screenshot({path:path.join(screenshots,'phone-finished.png')});
    await one.emulateMedia({reducedMotion:'reduce'});
    await tv.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await tv.locator('.world-light').evaluate(e=>getComputedStyle(e).animationName),'none');
    assert.equal(errors.length,0,errors.join('\n'));
    console.log('Cinema browser integration: TV navigation, PIN auto-open, 2 phones, error retry, match, undo, reconnect, Lampa request, exhaustion, 320px overflow, reduced motion passed.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
