from pathlib import Path
from html.parser import HTMLParser
import json,re,xml.etree.ElementTree as ET,urllib.robotparser,subprocess
R=Path(__file__).resolve().parents[1]
class Parse(HTMLParser):
 def __init__(self):super().__init__(convert_charrefs=True);self.schemas=[];self.active=False;self.buf='';self.ignore=0;self.text=[];self.ids=[];self.links=[]
 def handle_starttag(self,t,a):
  a=dict(a)
  if t=='template':self.ignore+=1
  if self.ignore:return
  if t=='script' and a.get('type')=='application/ld+json':self.active=True;self.buf=''
  if 'id' in a:self.ids.append(a['id'])
  if t=='a':self.links.append(a.get('href',''))
 def handle_endtag(self,t):
  if t=='template':self.ignore-=1
  if t=='script' and self.active:self.schemas.append(json.loads(self.buf));self.active=False
 def handle_data(self,d):
  if self.active:self.buf+=d
routes={'/':'index.html','/solo':'Solo.dc.html','/teams':'Team.dc.html','/coaches':'Coach.dc.html'}
routes.update({k:v['file'] for k,v in json.loads((R/'_site-source/discovery-manifest.json').read_text())['pages'].items()})
types={'Organization','Person','WebSite','WebPage','BreadcrumbList','Article','Service','Product','SoftwareApplication'}
for route,f in routes.items():
 p=Parse();p.feed((R/f).read_text());assert p.schemas,f
 assert len(p.ids)==len(set(p.ids)),f+' duplicate IDs'
 for schema in p.schemas:
  assert schema['@context']=='https://schema.org'
  nodes=schema['@graph'];ids={n.get('@id') for n in nodes if n.get('@id')}
  for n in nodes:
   assert n['@type'] in types
   if n['@type']=='BreadcrumbList':
    for i,item in enumerate(n['itemListElement'],1):assert item['position']==i and item['item'].startswith('https://neurobusiness.one/') and item['name']
   else:assert n.get('name') or n.get('headline'),(f,n)
   if n['@type']=='Article':assert n.get('author') and n.get('dateModified') and n.get('mainEntityOfPage')
   if n['@type']=='Service':assert n.get('provider')
  def refs(x):
   if isinstance(x,dict):
    if set(x)=={'@id'}:assert x['@id'] in ids,(f,x)
    for v in x.values():refs(v)
   elif isinstance(x,list):
    for v in x:refs(v)
  refs(nodes)
 for href in p.links:
  if href.startswith('#') and len(href)>1:assert href[1:] in p.ids,(f,href)
xml=ET.parse(R/'sitemap.xml');locs=[n.text for n in xml.findall('.//{*}loc')];assert len(locs)==len(set(locs))==len(routes)
assert set(locs)=={'https://neurobusiness.one'+r for r in routes}
robots=urllib.robotparser.RobotFileParser();robots.parse((R/'robots.txt').read_text().splitlines())
for bot in ['Googlebot','Bingbot','OAI-SearchBot','ChatGPT-User','PerplexityBot','Claude-SearchBot','Claude-User','RandomBot']:
 for r in routes:assert robots.can_fetch(bot,'https://neurobusiness.one'+r),(bot,r)
 for r in ['/admin.html','/app/','/diagnostic.html?token=abc','/api/report','/result_v2.html','/_docs/a.md','/quiz']:
  assert not robots.can_fetch(bot,'https://neurobusiness.one'+r),(bot,r)
for bot in ['GPTBot','ClaudeBot']:assert not robots.can_fetch(bot,'https://neurobusiness.one/')
for f in ['workers/ai.js','support.js','assets/main.js','_redirects']:
 assert subprocess.check_output(['git','show','origin/master:'+f])==(R/f).read_bytes(),f
for f in ['diagnostic.html','result_v2.html','result_v2_en.html','app.html','team-dashboard.html','coach-login.html','admin.html','admin-login.html','practitioner.html','success.html','cancel.html','checkout-success.html','coach/index.html','hr/index.html','academy/index.html']:
 old=subprocess.check_output(['git','show','origin/master:'+f],text=True);new=(R/f).read_text()
 scripts=lambda s:re.findall(r'<script\b[^>]*>[\s\S]*?</script>',s,re.I)
 assert scripts(old)==scripts(new),f
print(f'PASS: {len(routes)} JSON-LD graphs (types, required local fields and entity references), sitemap, unique IDs, anchors, 10 crawler policies and funnel script preservation.')
