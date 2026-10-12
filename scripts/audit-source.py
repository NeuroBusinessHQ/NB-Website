"""Read-only inventory of the baseline repository, including static and template pages."""
import subprocess,re,json
from html.parser import HTMLParser
from pathlib import Path
class Page(HTMLParser):
 def __init__(self): super().__init__();self.h1=0;self.links=[];self.images=[];self.meta=[];self.headings=[]
 def handle_starttag(self,t,attrs):
  a=dict(attrs)
  if t=='h1':self.h1+=1
  if re.fullmatch('h[1-6]',t):self.headings.append(t)
  if t=='a':self.links.append(a.get('href',''))
  if t=='img':self.images.append({'alt':a.get('alt'),'width':a.get('width'),'height':a.get('height'),'src':a.get('src')})
  if t=='meta':self.meta.append(a)
files=subprocess.check_output(['git','ls-tree','-r','--name-only','origin/master'],text=True).splitlines();result={}
for f in files:
 if not f.endswith('.html'):continue
 s=subprocess.check_output(['git','show','origin/master:'+f],text=True);p=Page();p.feed(s)
 result[f]={'title':re.findall(r'<title>(.*?)</title>',s,re.S),'canonical':re.findall(r'<link[^>]+rel="canonical"[^>]*>',s),'template_placeholders':s.count('{{'),'h1_count':p.h1,'heading_sequence':p.headings,'links':p.links,'images_missing_alt':sum(i['alt'] is None for i in p.images),'images_without_dimensions':sum(not(i['width'] and i['height']) for i in p.images),'json_ld_blocks':s.count('application/ld+json'),'meta':p.meta}
Path('_site-source/baseline-audit.json').write_text(json.dumps(result,indent=2))
print(f'Audited {len(result)} baseline HTML files.')
