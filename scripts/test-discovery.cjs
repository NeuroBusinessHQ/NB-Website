const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');const {playwright}=require('./browser.cjs');
const base=process.env.TEST_BASE||'http://127.0.0.1:8766';const root=path.resolve(__dirname,'..');
const artifacts=process.env.ARTIFACT_DIR||path.join(root,'_site-source/previews');fs.mkdirSync(artifacts,{recursive:true});
const manifest=JSON.parse(fs.readFileSync(path.join(root,'_site-source/discovery-manifest.json'))).pages;
const pages=['/','/solo','/teams','/coaches',...Object.keys(manifest)];
(async()=>{const browser=await playwright().chromium.launch({executablePath:process.env.CHROME_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined),headless:true});const results=[];const internal=new Set();
try{
for(const js of [false,true]){const ctx=await browser.newContext({javaScriptEnabled:js,viewport:{width:390,height:844},reducedMotion:'reduce'});const p=await ctx.newPage();
// Do not submit payments, analytics, email or production API calls during local tests.
await p.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
for(const route of pages){const errors=[];const onError=e=>errors.push(e.message);p.on('pageerror',onError);const response=await p.goto(base+route);assert.equal(response.status(),200,route);if(js&&pages.indexOf(route)<4){await p.waitForSelector('#dc-root h1');await p.waitForSelector('#nb-static',{state:'detached'});}
const info=await p.evaluate(()=>{
const main=document.querySelector('main')||document.getElementById('dc-root');
return {title:document.title,description:document.querySelector('meta[name="description"]')?.content,canonical:[...document.querySelectorAll('link[rel="canonical"]')].map(x=>x.href),h1:[...document.querySelectorAll('h1')].filter(x=>x.getBoundingClientRect().width).map(x=>x.textContent),text:main?.innerText||'',overflow:document.documentElement.scrollWidth>innerWidth+1,links:[...document.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')),schema:[...document.querySelectorAll('script[type="application/ld+json"]')].map(s=>JSON.parse(s.textContent)),robots:document.querySelector('meta[name="robots"]')?.content};});
assert.equal(info.h1.length,1,route+' visible h1');assert(info.text.length>200,route+' readable content');assert(!info.text.includes('{{'),route+' no template placeholders');assert.equal(info.canonical.length,1,route+' one canonical');assert.equal(info.canonical[0],'https://neurobusiness.one'+route);assert(info.description);assert(!/noindex/.test(info.robots));assert(!info.overflow,route+' mobile overflow');assert.equal(errors.length,0,route+' JS errors: '+errors);assert(info.schema.length>0);
for(const graph of info.schema){assert.equal(graph['@context'],'https://schema.org');for(const n of graph['@graph']||[graph])assert(n['@type']);}
info.links.forEach(l=>{if(l.startsWith('/')&&!l.startsWith('//'))internal.add(l.split('#')[0].split('?')[0]);});
if(route==='/') await p.screenshot({path:path.join(artifacts,js?'homepage-mobile.png':'homepage-nojs-mobile.png'),fullPage:true});
if(js&&route==='/') {await p.getByRole('button',{name:'EN',exact:true}).first().click();await p.waitForFunction(()=>document.documentElement.lang==='en');assert((await p.locator('#dc-root').innerText()).includes('For teams'));await p.getByRole('button',{name:'DE',exact:true}).first().click();}
if(js&&route==='/teams') {assert(await p.locator('a[href*="wa.me"]').count()>0);}
results.push({route,javaScript:js,title:info.title,readableCharacters:info.text.length,mobileOverflow:info.overflow});p.off('pageerror',onError);
}
await ctx.close();}
for(const route of internal){if(route==='/quiz')continue;const response=await fetch(base+route);assert(response.status<400,route+' broken link '+response.status);}
for(const route of ['/robots.txt','/sitemap.xml','/llms.txt']){const r=await fetch(base+route);assert.equal(r.status,200);assert(!(await r.text()).startsWith('<!doctype'));}
assert.equal((await fetch(base+'/nonexistent-discovery-test')).status,404);
for(const route of ['/admin.html','/result_v2.html','/_docs/LAUNCH_CHECKLIST.md']){const r=await fetch(base+route);assert(r.status===404||/noindex/.test(r.headers.get('x-robots-tag')));}
const desktop=await browser.newPage({viewport:{width:1440,height:1000}});await desktop.goto(base+'/ai-readiness');await desktop.screenshot({path:path.join(artifacts,'ai-readiness-desktop.png'),fullPage:true});await desktop.setViewportSize({width:390,height:844});await desktop.screenshot({path:path.join(artifacts,'ai-readiness-mobile.png'),fullPage:true});
fs.writeFileSync(process.env.VALIDATION_OUTPUT||path.join(root,'_site-source/validation-results.json'),JSON.stringify({origin:base,results,internalLinksChecked:internal.size,checkedAt:new Date().toISOString()},null,2));console.log(`PASS: ${results.length} JS/no-JS mobile page checks, ${internal.size} internal paths, discovery endpoints and 404.`);
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
