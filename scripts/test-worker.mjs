import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const source=await fs.readFile(new URL('../_worker.js',import.meta.url),'utf8');
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
let calls=[];const env={ASSETS:{fetch:async req=>{calls.push(req);return new Response('asset',{headers:{'content-type':'text/html'}})}}};
for(const path of ['/_db/a.sql','/_docs/a.md','/%5Fdb/a.sql','/_site-source/index.html','/scripts/build-discovery.py','/workers/ai.js','/CONTENT_PLAN_30TAGE.csv']){assert.equal((await worker.fetch(new Request('https://neurobusiness.one'+path),env)).status,404,path)}
for(const path of ['/app.html','/app/','/admin-login.html','/diagnostic.html?token=abc','/result_v2_en.html','/api/report','/?token=abc']){const r=await worker.fetch(new Request('https://neurobusiness.one'+path),env);assert.match(r.headers.get('X-Robots-Tag'),/noindex/);assert.equal(calls.at(-1).url,'https://neurobusiness.one'+path);}
for(const [from,to] of [['/ai-adoption-consulting','/ai-adoption'],['/ai-transformation','/human-ai-transformation'],['/Homepage.dc.html','/']]){const r=await worker.fetch(new Request('https://neurobusiness.one'+from+'?utm_source=test'),env);assert.equal(r.status,301);assert.equal(r.headers.get('location'),'https://neurobusiness.one'+to+'?utm_source=test')}
for(const [route,file] of [['solo','Solo.dc'],['teams','Team.dc'],['coaches','Coach.dc']]){await worker.fetch(new Request('https://neurobusiness.one/'+route+'?utm_source=test'),env);assert.equal(new URL(calls.at(-1).url).pathname,'/'+file+'.html');assert.equal(new URL(calls.at(-1).url).search,'?utm_source=test')}
const post=new Request('https://neurobusiness.one/api/test',{method:'POST',body:'keep-this'});await worker.fetch(post,env);assert.equal(calls.at(-1),post);assert.equal(await post.text(),'keep-this');
const oldFetch=globalThis.fetch;globalThis.fetch=async req=>{assert.equal(new URL(req.url).pathname,'/quiz');assert.equal(new URL(req.url).search,'?lang=en&source=test');return new Response('upstream',{headers:{'content-type':'application/json'}})};
const quiz=await worker.fetch(new Request('https://neurobusiness.one/quiz?lang=en&source=test'),env);assert.equal(await quiz.text(),'upstream');assert.match(quiz.headers.get('X-Robots-Tag'),/noindex/);globalThis.fetch=oldFetch;
console.log('Worker: source denial, private headers, redirects, marketing routes, query strings, API POST and quiz proxy pass.');
for(const [from,to] of [['/Solo.dc','/solo'],['/Team.dc.html','/teams'],['/Coach.dc','/coaches'],['/Homepage.dc','/']]){const r=await worker.fetch(new Request('https://neurobusiness.one'+from+'?ref=keep'),env);assert.equal(r.status,301);assert.equal(r.headers.get('location'),'https://neurobusiness.one'+to+'?ref=keep');}
const cfAssets={ASSETS:{fetch:async req=>new URL(req.url).pathname.endsWith('.html')?new Response(null,{status:308,headers:{location:'/Solo.dc'}}):new Response('resolved asset')}};
const resolved=await worker.fetch(new Request('https://neurobusiness.one/solo'),cfAssets);assert.equal(resolved.status,200);assert.equal(await resolved.text(),'resolved asset');
const host=await worker.fetch(new Request('https://www.neurobusiness.one/ai-readiness?utm_source=keep'),env);assert.equal(host.headers.get('location'),'https://neurobusiness.one/ai-readiness?utm_source=keep');
console.log('Worker: legacy aliases, Cloudflare asset redirects and public host normalization pass.');
