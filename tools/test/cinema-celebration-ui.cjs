/* Production CSS/JS with a deterministic Android bridge fixture. CI renders, never the live TV. */
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const movie=JSON.parse(fs.readFileSync(path.join(root,'web/cinema-catalog.json')))[0];
const captures=path.join(root,'.impeccable/review');
const initial={ok:true,round:null,names:[],progress:[],matches:[],mine:{},joined:false,catalog:[movie]};
const html=`<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="style.css"><link rel="stylesheet" href="cinema.css"><style>html,body{margin:0;overflow:hidden}#stage{left:0;top:0}</style><body><div id="stage"></div><script>
window.sceneFixture=${JSON.stringify(initial)};
window.TV={cinema:function(action,body){if(action==='play')window.lastPlayed=JSON.parse(body).id;return JSON.stringify(window.sceneFixture)},remoteInfo:function(){return JSON.stringify({url:'http://192.168.1.18:8765/?pin=000000',ip:'192.168.1.18',port:8765})}};
window.tvBack=function(){return false};
document.getElementById('stage').style.zoom=Math.min(document.documentElement.clientWidth/1920,innerHeight/1080);
</script><script src="vendor/qrcode.js"></script><script src="cinema.js" defer></script></body></html>`;
(async()=>{
 fs.mkdirSync(captures,{recursive:true});
 const cover=await fetch('https://image.tmdb.org/t/p/w500'+movie.poster,{signal:AbortSignal.timeout(20000)});
 assert(cover.ok,'TMDB fixture poster unavailable');const poster=Buffer.from(await cover.arrayBuffer());
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}: {})});
 const errors=[];
 try{
  for(const [width,height] of [[1920,1080],[960,540]]){
   const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
   const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(u.hostname==='image.tmdb.org')return route.fulfill({contentType:'image/jpeg',body:poster});
    if(u.hostname!=='tvhome.test')return route.abort();
    if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:html});
    const file=path.join(root,'web',u.pathname);
    if(!file.startsWith(path.join(root,'web')+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
    const type={'.js':'application/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'}[path.extname(file)];
    return route.fulfill({contentType:type||'application/octet-stream',body:fs.readFileSync(file)});
   });
   await page.goto('http://tvhome.test/');await page.waitForFunction(()=>!!window.Cinema);
   await page.evaluate(()=>Cinema.openTV());await page.locator('.cn-qr').waitFor();
   assert.equal(await page.locator('.cn-celebration').count(),0);
   await page.evaluate(()=>{sceneFixture.round='ci-night';sceneFixture.names=['Глядач 1','Глядач 2'];sceneFixture.progress=[1,1];sceneFixture.matches=[sceneFixture.catalog[0].id];document.dispatchEvent(new Event('visibilitychange'));});
   await page.locator('.cn-celebration.is-visible').waitFor();
   await page.waitForFunction(()=>{const image=document.querySelector('.cn-celebration-poster img');return image&&image.complete&&image.naturalWidth>0});
   await page.waitForTimeout(320);
   assert.equal(await page.locator('[data-cn="celebrate-continue"]').evaluate(b=>b===document.activeElement),true);
   for(const selector of ['.cn-celebration-poster','.cn-celebration-copy','.cn-celebration-actions']){
    const b=await page.locator(selector).boundingBox();assert(b&&b.x>=0&&b.y>=0&&b.x+b.width<=width+1&&b.y+b.height<=height+1,'bounds '+selector+' at '+width);
   }
   await page.screenshot({path:path.join(captures,'celebration-'+width+'.png'),fullPage:true});
   await page.emulateMedia({reducedMotion:'reduce'});
   assert.equal(await page.locator('.cn-celebration-copy').evaluate(e=>getComputedStyle(e).transitionDelay),'0s');
   assert.equal(await page.locator('.cn-celebration-copy').evaluate(e=>getComputedStyle(e).transitionDuration),'0.16s');
   await page.keyboard.press('ArrowLeft');assert.equal(await page.locator('[data-cn^="celebrate-play:"]').evaluate(b=>b===document.activeElement),true);
   await page.keyboard.press('Escape');await page.keyboard.press('Escape');await page.waitForTimeout(260);assert.equal(await page.locator('.cn-celebration').count(),0);
   assert.equal(await page.locator('.cn-panel').count(),1);
   await context.close();
  }
  assert.deepEqual(errors,[]);
  console.log('TV match render passed at 1920x1080 and 960x540: real poster, visible actions, bounds, focus, D-pad and double Back.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
