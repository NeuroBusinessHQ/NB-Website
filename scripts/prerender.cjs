/* Rebuild committed snapshots after editing _site-source/*.html.
   Uses the original runtime; no changes to quiz, checkout or scoring logic. */
const fs=require('node:fs');const path=require('node:path');const http=require('node:http');
const {playwright}=require('./browser.cjs');const root=path.resolve(__dirname,'..');
const pages={'index.html':'/','Solo.dc.html':'/solo','Team.dc.html':'/teams','Coach.dc.html':'/coaches'};
const base='https://neurobusiness.one';
(async()=>{
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://local');let file=decodeURIComponent(url.pathname).slice(1)||'index.html';const source=pages[file]!==undefined?'_site-source/'+file:file;const f=path.resolve(root,source);if(!f.startsWith(root+path.sep)||!fs.existsSync(f)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.svg')?'image/svg+xml':'text/html');res.end(fs.readFileSync(f));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await playwright().chromium.launch({executablePath:process.env.CHROME_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined),headless:true});
try {for(const [file,route] of Object.entries(pages)){
const context=await browser.newContext({reducedMotion:'reduce',viewport:{width:1440,height:1000}});const p=await context.newPage();
await p.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
await p.goto(`http://127.0.0.1:${server.address().port}/${file}?lang=de`);await p.waitForSelector('#dc-root h1');
const snapshot=await p.locator('#dc-root').evaluate(el=>{
const copy=el.cloneNode(true);
copy.querySelectorAll('button').forEach(b=>{const span=document.createElement('span');span.textContent=b.textContent;span.setAttribute('style',b.getAttribute('style')||'');b.replaceWith(span)});
copy.querySelectorAll('[id]').forEach(n=>n.id='static-'+n.id);
copy.querySelectorAll('a[href^="#"]').forEach(n=>n.setAttribute('href','#static-'+n.getAttribute('href').slice(1)));
copy.querySelectorAll('[style]').forEach(n=>{if(n.style.opacity==='0')n.style.opacity='1'});
return copy.innerHTML;
});
let source=fs.readFileSync(path.join(root,'_site-source',file),'utf8');
const template=source.match(/<x-dc>([\s\S]*?)<\/x-dc>/)[1];
const styles=await p.locator('head style').allTextContents();
const title=await p.title();const description=await p.locator('meta[name="description"]').getAttribute('content');
const graph={'@context':'https://schema.org','@graph':[
{'@type':'Organization','@id':base+'/#organization',name:'NeuroBusiness',url:base+'/',founder:{'@id':base+'/founder#person'}},
{'@type':'Person','@id':base+'/founder#person',name:'Eva Kolontai',url:base+'/founder'},
{'@type':'WebSite','@id':base+'/#website',name:'NeuroBusiness',url:base+'/',publisher:{'@id':base+'/#organization'}},
{'@type':'WebPage','@id':base+route+'#webpage',url:base+route,name:title,description,inLanguage:'de',isPartOf:{'@id':base+'/#website'}},
...(route==='/'?[]:[{'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'NeuroBusiness',item:base+'/'},{'@type':'ListItem',position:2,name:title,item:base+route}]}]),
...(route==='/solo'?[{'@type':'SoftwareApplication','@id':base+'/solo#companion',name:'NeuroBusiness AI Companion',applicationCategory:'BusinessApplication',operatingSystem:'Web',url:base+'/solo',author:{'@id':base+'/#organization'}},{'@type':'Product','@id':base+'/solo#product',name:'NeuroBusiness Solo Report',description,brand:{'@id':base+'/#organization'},url:base+'/solo'}]:[]),
...(['/teams','/coaches'].includes(route)?[{'@type':'Service','@id':base+route+'#service',name:route==='/teams'?'NeuroBusiness Team Intelligence':'NeuroBusiness Practitioner',provider:{'@id':base+'/#organization'},url:base+route,description}]:[])
]};
source=source.replace(/<script src="\.\/support\.js[^>]*><\/script>/,'');
source=source.replace('<html lang="de">','<html lang="de" class="nb-prerender">');
source=source.replace(/<x-dc>[\s\S]*?<\/x-dc>/,`<main id="nb-static">${snapshot}</main>\n<template id="nb-template">${template}</template>\n<script src="/assets/prerender-bridge.js"></script>\n<script src="/support.js?v=20260725-1"></script>`);
source=source.replace('</head>',`<style>${styles.join('\n')}\nx-dc{display:none!important}.nb-prerender #dc-root{display:none!important}</style>\n<script type="application/ld+json">${JSON.stringify(graph).replaceAll('<','\\u003c')}</script>\n<link rel="alternate" type="text/plain" href="/llms.txt" title="Discovery index">\n</head>`);
if(!source.includes('name="twitter:card"')) source=source.replace('</head>',`<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content=${JSON.stringify(title)}><meta name="twitter:description" content=${JSON.stringify(description)}><meta name="twitter:image" content="${base}/og-image.jpg"><meta property="og:image" content="${base}/og-image.jpg">\n</head>`);
fs.writeFileSync(path.join(root,file),source.replace(/[ \t]+$/gm,''));console.log(`Prerendered ${route}: ${snapshot.length} static characters`);await context.close();
}}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1)});
