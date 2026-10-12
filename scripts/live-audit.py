"""Read-only HTTP audit. User-agent probes do not verify actual bot IP access."""
import urllib.request,urllib.error,json,re,concurrent.futures
from pathlib import Path
BASE='https://neurobusiness.one'
checks=[(BASE+p,'NeuroBusiness-Discovery-Audit/1.0') for p in ['/','/solo','/teams','/coaches','/robots.txt','/sitemap.xml','/llms.txt','/nonexistent-audit-20261012','/ai-readiness']]
checks += [(BASE+'/',ua) for ua in ['Googlebot','Bingbot','OAI-SearchBot','ChatGPT-User','GPTBot','ClaudeBot','PerplexityBot']]
checks += [('https://www.neurobusiness.one/','NeuroBusiness-Discovery-Audit/1.0')]
checks += [('https://www.germaninstitute.eu/'+p,'NeuroBusiness-Discovery-Audit/1.0') for p in ['impressum.html','datenschutz.html']]
def check(x):
 url,ua=x
 try:
  with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':ua}),timeout=20) as r:
   body=r.read().decode('utf-8',errors='replace');return dict(url=url,agent=ua,status=r.status,final_url=r.url,content_type=r.headers.get('Content-Type'),server=r.headers.get('Server'),robots=r.headers.get('X-Robots-Tag'),challenge=r.headers.get('cf-mitigated'),title=re.findall(r'<title>(.*?)</title>',body,re.S),h1=re.findall(r'<h1\b[^>]*>(.*?)</h1>',body,re.S),template_tokens=body.count('{{'),bytes=len(body),canonical=re.findall(r'<link[^>]+rel="canonical"[^>]*>',body),text=body if url.endswith(('.txt','.xml')) else None)
 except Exception as ex:return dict(url=url,agent=ua,error=str(ex))
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool: rows=list(pool.map(check,checks))
Path('_site-source/live-audit.json').write_text(json.dumps(rows,indent=2))
for r in rows:print(r['url'],r['agent'],r.get('status',r.get('error')),r.get('final_url'),r.get('title'))
