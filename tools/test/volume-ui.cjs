/* Render the real phone remote, with only its Android HTTP API replaced by deterministic fixtures. */
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),shots=path.join(root,'.impeccable/review');
(async()=>{
 fs.mkdirSync(shots,{recursive:true});
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try{
 for(const width of [320,390,480]){
  const context=await browser.newContext({viewport:{width,height:844},reducedMotion:'reduce'}),page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let vol=8,muted=false,fixed=false,fail=false;
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.host!=='tvhome.test')return route.abort();
   const snap=()=>({ok:true,model:'Mi Box',vol,volMax:15,muted,volFixed:fixed,clients:[],media:{},imeCurrent:true,adb:'off',apps:[]});
   if(u.pathname.startsWith('/api/')){
    if(u.pathname==='/api/vol'||u.pathname==='/api/key'){
     if(fail)return route.fulfill({json:{ok:false,error:'volume'}});
     if(u.pathname==='/api/vol'){vol=Number(u.searchParams.get('v'));muted=vol===0;}
     else{const k=u.searchParams.get('k');if(k==='mute')muted=!muted;if(k==='volup'){vol=Math.min(15,vol+1);muted=false;}if(k==='voldown')vol=Math.max(0,vol-1);}
    }
    return route.fulfill({json:snap()});
   }
   let asset=u.pathname==='/'?'remote.html':u.pathname.slice(1);if(asset==='manifest.json')asset='remote-manifest.json';
   const file=path.resolve(root,'web',asset);if(!file.startsWith(path.join(root,'web')+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
   const type={'.html':'text/html','.css':'text/css','.js':'application/javascript','.woff2':'font/woff2','.svg':'image/svg+xml','.json':'application/json'}[path.extname(file)];
   return route.fulfill({contentType:type||'application/octet-stream',body:fs.readFileSync(file)});
  });
  await page.goto('http://tvhome.test/?pin=000000');const panel=page.locator('#volume'),input=panel.locator('input');
  await page.waitForFunction(()=>document.querySelector('#volume output').textContent==='53%');
  await page.evaluate(()=>document.fonts.ready);await panel.scrollIntoViewIfNeeded();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal page overflow');
  const b=await panel.boundingBox();assert(b.x>=0&&b.x+b.width<=width,'volume panel fits');
  await panel.screenshot({path:path.join(shots,'volume-phone-'+width+'.png')});
  if(width===390)await page.screenshot({path:path.join(shots,'volume-remote-full.png'),fullPage:true});
  await panel.locator('[data-volume="mute"]').click();await page.waitForFunction(()=>document.querySelector('#volume output').textContent==='0%');assert.equal(await panel.locator('[data-volume="mute"]').getAttribute('aria-pressed'),'true');
  await input.focus();await page.keyboard.press('End');await page.waitForFunction(()=>document.querySelector('#volume output').textContent==='100%');await page.waitForFunction(()=>document.querySelector('#volume').getAttribute('aria-busy')==='false');assert.equal(muted,false);
  await page.keyboard.press('ArrowLeft');await page.waitForFunction(()=>document.querySelector('#volume output').textContent==='93%');
  await panel.locator('[data-volume="voldown"]').click();await page.waitForFunction(()=>document.querySelector('#volume output').textContent==='87%');
  fail=true;await panel.locator('[data-volume="volup"]').click();await panel.locator('.volume-message').filter({hasText:'Не вдалося'}).waitFor();assert.equal(await input.inputValue(),'13');fail=false;
  fixed=true;await page.waitForFunction(()=>document.querySelector('#volume input').disabled);assert(await panel.locator('[data-volume="mute"]').isDisabled());
  if(width===390)await panel.screenshot({path:path.join(shots,'volume-fixed.png')});
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('Phone volume UI passed at320/390/480: real remote, bounds, percentage, mute, keyboard range, unmute, ordered response, rollback, fixed output.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
