"""Local authorization checks with a second owner's isolated, disposable metadata."""
import http.cookiejar, json, subprocess, urllib.request, urllib.error, uuid

BASE = 'http://localhost:5173'
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
client.open(BASE + '/signin-with-chatgpt?return_to=/').read()

def request(path, data=None, expected=200, headers=None, opener=client):
    body = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(BASE + path, data=body, headers={'Content-Type':'application/json', **(headers or {})})
    try:
        with opener.open(req, timeout=30) as r: code, result = r.status, json.load(r)
    except urllib.error.HTTPError as e:
        code=e.code; raw=e.read().decode()
        try: result=json.loads(raw)
        except json.JSONDecodeError: result={'error':raw[:200]}
    assert code == expected, (path, code, result)
    return result

def sql(command):
    result = subprocess.run(['node','--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','wrangler.local.json','--command',command], capture_output=True, text=True)
    if result.returncode: raise RuntimeError(result.stderr)

own = request('/api/studio')['projects'][0]['id']
w, p, image, job, private, commercial = [str(uuid.uuid4()) for _ in range(6)]
insert = f"""
INSERT INTO workspaces VALUES('{w}','qa_other_owner','QA isolation fixture','2026-01-01');
INSERT INTO projects(id,workspace_id,name,created) VALUES('{p}','{w}','QA other project','2026-01-01');
INSERT INTO images(id,project_id,name,key,width,height,created,digest) VALUES('{image}','{p}','QA private image','qa-missing',320,320,'2026-01-01','{image}');
INSERT INTO jobs(id,project_id,status,created,updated,classes,snapshot) VALUES('{job}','{p}','complete','2026-01-01','2026-01-01','[]','[]');
INSERT INTO packs VALUES('{private}','qa_other_owner','{p}','{job}','QA private pack','','private','QA only','2026-01-01');
INSERT INTO packs VALUES('{commercial}','qa_other_owner','{p}','{job}','QA commercial pack','','marketplace','QA only','2026-01-01');
"""
try:
    sql(insert)
    anonymous = urllib.request.build_opener()
    request('/api/studio',expected=401,headers={'oai-authenticated-user-id':'qa_other_owner'},opener=anonymous)
    request('/api/studio?project='+p,expected=404)
    request('/api/studio?kind=image&id='+image,expected=404)
    request('/api/studio?kind=export&id='+job,expected=404)
    request('/api/studio?kind=job&id='+job,expected=404)
    request('/api/studio',{'action':'sku','projectId':p,'name':'Unauthorized'},expected=404)
    state=request('/api/studio')
    assert not any(k['id']==private for k in state['packs'])
    request('/api/studio',{'action':'activate','projectId':own,'packId':private,'acceptTerms':True},expected=404)
    license=request('/api/studio',{'action':'activate','projectId':own,'packId':commercial,'acceptTerms':True})
    assert license['status']=='requested'
    request('/api/studio',{'action':'predict','projectId':own,'packId':commercial,'image':'AA=='},expected=403)
    record=next(l for l in request('/api/studio')['licenses'] if l['pack_id']==commercial)
    request('/api/studio',{'action':'approveLicense','id':record['id']},expected=404)
    request('/api/studio',{'action':'workspace','name':'Cross-origin'},expected=403,headers={'Origin':'https://foreign.example'})
    request('/api/infer',{'image':'AA=='},expected=401,headers={'Authorization':'Bearer pdt_invalid'})
    try:
        urllib.request.urlopen('http://127.0.0.1:8001/health')
        raise AssertionError('Worker accepted an anonymous request')
    except urllib.error.HTTPError as e: assert e.code==401
    print('PASS tenant isolation, private image/model access, license approval, header spoofing, CSRF and API/worker credentials')
finally:
    sql(f"DELETE FROM licenses WHERE pack_id IN ('{private}','{commercial}'); DELETE FROM packs WHERE id IN ('{private}','{commercial}'); DELETE FROM jobs WHERE id='{job}'; DELETE FROM images WHERE id='{image}'; DELETE FROM projects WHERE id='{p}'; DELETE FROM workspaces WHERE id='{w}';")
