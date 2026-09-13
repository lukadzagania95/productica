"""End-to-end development smoke test. Uses synthetic test fixtures, not SKU benchmarks."""
import base64,io,json,sys,time,urllib.request,urllib.error,http.cookiejar,uuid
from PIL import Image,ImageDraw
BASE='http://localhost:5173';jar=http.cookiejar.CookieJar();client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
def get(path):
 with client.open(BASE+path,timeout=120) as r:return json.load(r)
def post(data,expected=200):
 req=urllib.request.Request(BASE+'/api/studio',data=json.dumps(data).encode(),headers={'Content-Type':'application/json','Origin':BASE})
 try:
  with client.open(req,timeout=120) as r:status=r.status;result=json.load(r)
 except urllib.error.HTTPError as e:status=e.code;result=json.load(e)
 assert status==expected,(status,result,data.get('action'));return result
try:urllib.request.urlopen(BASE+'/api/studio');raise AssertionError('Anonymous access succeeded')
except urllib.error.HTTPError as e:assert e.code==401
client.open(BASE+'/signin-with-chatgpt?return_to=/').read()
state=get('/api/studio');assert state['workerConfigured'];print('PASS sign-in and worker configuration',flush=True)
w=post({'action':'workspace','name':'QA sandbox '+str(uuid.uuid4())[:6]})['id'];pid=post({'action':'project','workspaceId':w,'name':'Synthetic pipeline test'})['id'];sku=post({'action':'sku','projectId':pid,'name':'QA test product'})['id'];print('PASS workspace, project and SKU persistence',flush=True)
images=[]
for i in range(4):
 im=Image.new('RGB',(320,320),(235+i,240,245));draw=ImageDraw.Draw(im);x=65+i*12;draw.rectangle((x,55,x+90,260),fill=(175,210,83));draw.rectangle((x+10,100,x+80,180),fill=(21,40,51));b=io.BytesIO();im.save(b,format='JPEG');raw=b.getvalue();boundary='productica-'+uuid.uuid4().hex;body=b''
 for key,val in [('projectId',pid),('width','320'),('height','320')]:body+=f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{val}\r\n'.encode()
 body+=f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="qa-{i}.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'.encode()+raw+f'\r\n--{boundary}--\r\n'.encode()
 with client.open(urllib.request.Request(BASE+'/api/studio',data=body,headers={'Content-Type':'multipart/form-data; boundary='+boundary,'Origin':BASE})) as r:iid=json.load(r)['id']
 boxes=[{'skuId':sku,'x':x/320,'y':55/320,'w':90/320,'h':205/320}];post({'action':'annotations','projectId':pid,'imageId':iid,'boxes':boxes,'split':'validation' if i==3 else 'train','reviewed':True});images.append((iid,raw))
assert len(get('/api/studio?project='+pid)['images'])==4;print('PASS upload, durable images, labels, dataset splits',flush=True)
post({'action':'annotations','projectId':pid,'imageId':images[0][0],'boxes':[{'skuId':'foreign','x':0,'y':0,'w':1,'h':1}],'split':'train','reviewed':True},400)
post({'action':'project','workspaceId':str(uuid.uuid4()),'name':'Forbidden'},404);print('PASS invalid labels and workspace authorization',flush=True)
jid=post({'action':'train','projectId':pid})['id'];print('STARTED real training',jid,flush=True)
for _ in range(180):
 j=get('/api/studio?kind=job&id='+jid)
 if j['status'] not in ('queued','running'):break
 time.sleep(3)
assert j['status']=='complete',j
m=j['metrics'];m=json.loads(m) if isinstance(m,str) else m;assert isinstance(m['map'],float);assert m['validationImages']==1;print('PASS real pretrained-model training and held-out evaluation',flush=True)
post({'action':'promote','projectId':pid,'jobId':jid});test=base64.b64encode(images[-1][1]).decode();result=post({'action':'predict','projectId':pid,'jobId':jid,'image':test});assert isinstance(result['predictions'],list);print('PASS model promotion and image inference',flush=True)
k=post({'action':'publish','projectId':pid,'jobId':jid,'name':'QA test recognition','description':'Synthetic fixture, not a benchmark.','visibility':'shared','terms':'QA use only','consent':True})['id'];p2=post({'action':'project','workspaceId':w,'name':'Pack reuse test'})['id'];post({'action':'activate','projectId':p2,'packId':k,'acceptTerms':True});post({'action':'predict','projectId':p2,'packId':k,'image':test});assert not get('/api/studio?project='+p2)['images'];print('PASS pack reuse without raw training images',flush=True)
key=post({'action':'apiKey','projectId':pid})['key'];req=urllib.request.Request(BASE+'/api/infer',data=json.dumps({'image':test}).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+key})
with urllib.request.urlopen(req,timeout=120) as r:assert isinstance(json.load(r)['predictions'],list)
with client.open(BASE+'/api/studio?kind=export&id='+jid,timeout=120) as r:assert len(r.read())>100000
print('PASS authenticated inference API and model export',flush=True)
from pathlib import Path
Path('test-results').mkdir(exist_ok=True);Path('test-results/smoke.json').write_text(json.dumps({'workspaceId':w,'projectId':pid,'reuseProjectId':p2,'jobId':jid,'packId':k,'metrics':m},indent=2))
print('ALL END-TO-END CHECKS PASSED',flush=True)
