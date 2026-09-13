"""Productica's authenticated training-job service. Real pretrained detector fine-tuning."""
import base64, hashlib, hmac, io, json, os, threading, time, uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
import numpy as np
from PIL import Image, ImageOps
import torch
from fastapi import FastAPI, Depends, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from torchvision.models.detection import fasterrcnn_mobilenet_v3_large_320_fpn, FasterRCNN_MobileNet_V3_Large_320_FPN_Weights
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor
from torchvision.transforms.functional import to_tensor

ROOT=Path(os.getenv('PRODUCTICA_MODELS_DIR','./models')).resolve();ROOT.mkdir(parents=True,exist_ok=True)
torch.set_num_threads(min(4,os.cpu_count() or 1))
DEVICE='cuda' if torch.cuda.is_available() else 'cpu'
POOL=ThreadPoolExecutor(max_workers=1)
commit=lambda: None
reload=lambda: None
@asynccontextmanager
async def lifespan(app):
    if os.getenv('PRODUCTICA_DISTRIBUTED')!='1':
        for path in ROOT.glob('*/status.json'):
            previous=json.loads(path.read_text())
            if previous.get('status') in ('running','queued'):
                status(path.parent.name,status='failed',message='Worker restarted. Start a new training job.',progress=0)
    yield
app=FastAPI(title='Productica Recognition Service',docs_url=None,redoc_url=None,lifespan=lifespan)

def auth(authorization:str=Header(default='')):
    secret=os.getenv('TRAINING_WORKER_KEY','')
    if not secret or not hmac.compare_digest(authorization,'Bearer '+secret):raise HTTPException(401,'Invalid worker credential.')
def folder(jid):
    try: uuid.UUID(jid)
    except (ValueError,TypeError): raise HTTPException(400,'Invalid model identifier.')
    return ROOT/jid
def status(jid,**values):
    d=folder(jid);d.mkdir(exist_ok=True);p=d/'status.json';old=json.loads(p.read_text()) if p.exists() else {};old.update(values);tmp=d/f'status-{uuid.uuid4()}.tmp';tmp.write_text(json.dumps(old));tmp.replace(p);commit()
def decode(encoded):
    if not isinstance(encoded,str) or len(encoded)>5_000_000:raise ValueError('Image too large.')
    im=Image.open(io.BytesIO(base64.b64decode(encoded,validate=True)))
    if im.width*im.height>16_000_000:raise ValueError('Image dimensions exceed the limit.')
    return ImageOps.exif_transpose(im).convert('RGB')
def make_model(n=None,pretrained=True):
    m=fasterrcnn_mobilenet_v3_large_320_fpn(weights=FasterRCNN_MobileNet_V3_Large_320_FPN_Weights.DEFAULT if pretrained else None,weights_backbone=None,min_size=320,max_size=640)
    if n is not None:m.roi_heads.box_predictor=FastRCNNPredictor(m.roi_heads.box_predictor.cls_score.in_features,n+1)
    return m

def iou(a,b):
    x1,y1=max(a[0],b[0]),max(a[1],b[1]);x2,y2=min(a[2],b[2]),min(a[3],b[3]);i=max(0,x2-x1)*max(0,y2-y1);u=max(0,a[2]-a[0])*max(0,a[3]-a[1])+max(0,b[2]-b[0])*max(0,b[3]-b[1])-i
    return i/u if u else 0

def evaluate(preds,truth,classes):
    per=[]; aps=[];matrix=np.zeros((len(classes)+1,len(classes)+1),dtype=int)
    for ci,c in enumerate(classes,1):
        total=sum(sum(int(v)==ci for v in t['labels']) for t in truth); ca=[];p50=r50=0
        ranked=sorted([(float(sc),im,box) for im,p in enumerate(preds) for box,label,sc in zip(p['boxes'],p['labels'],p['scores']) if int(label)==ci],reverse=True,key=lambda x:x[0])
        for threshold in np.arange(.5,.951,.05):
            used=set();tp=[];fp=[]
            for score,im,box in ranked:
                options=[(iou(box,tb),ti) for ti,(tb,tl) in enumerate(zip(truth[im]['boxes'],truth[im]['labels'])) if int(tl)==ci and (im,ti) not in used]
                overlap,ti=max(options,default=(0,-1))
                hit=overlap>=threshold
                if hit:used.add((im,ti))
                tp.append(int(hit));fp.append(int(not hit))
            if not total:continue
            tc=np.cumsum(tp);fc=np.cumsum(fp);rec=tc/total;prec=tc/np.maximum(tc+fc,1)
            ap=float(np.mean([max(prec[rec>=r],default=0) for r in np.linspace(0,1,101)]));ca.append(ap)
            if threshold==.5:
                accepted=sum(score>=.5 for score,_,_ in ranked);p50=float(tc[accepted-1]/accepted) if accepted else 0;r50=float(tc[accepted-1]/total) if accepted else 0
        score=float(np.mean(ca)) if ca else 0;aps.append(score);per.append({'id':c['id'],'name':c['name'],'precision':p50,'recall':r50,'ap':score,'support':total})
    for p,t in zip(preds,truth):
        used=set()
        for box,label,score in zip(p['boxes'],p['labels'],p['scores']):
            if score<.5:continue
            overlap,ti=max([(iou(box,tb),ti) for ti,tb in enumerate(t['boxes']) if ti not in used],default=(0,-1))
            actual=int(t['labels'][ti])-1 if overlap>=.5 else len(classes)
            if overlap>=.5:used.add(ti)
            matrix[actual,int(label)-1]+=1
        for ti,label in enumerate(t['labels']):
            if ti not in used:matrix[int(label)-1,len(classes)]+=1
    return {'map':float(np.mean(aps)),'precision':float(np.mean([c['precision'] for c in per])),'recall':float(np.mean([c['recall'] for c in per])),'perClass':per,'confusion':matrix.tolist(),'confusionLabels':[c['name'] for c in classes]+['Background'],'validationImages':len(truth),'definition':'mAP at IoU 0.50:0.95, 101-point interpolation. Macro precision/recall at confidence 0.50 and IoU 0.50.'}

def train(payload):
    jid=payload['id'];reload();d=folder(jid);start=time.monotonic()
    try:
        torch.manual_seed(42);status(jid,status='running',progress=3,message='Loading pretrained detector')
        classes=payload['classes'];mapping={c['id']:i+1 for i,c in enumerate(classes)};dataset=[];val=[]
        for item in payload['images']:
            im=decode(item['image']);im.thumbnail((640,640));w,h=im.size;boxes=[];labels=[]
            for a in item['boxes']:
                boxes.append([a['x']*w,a['y']*h,(a['x']+a['w'])*w,(a['y']+a['h'])*h]);labels.append(mapping[a['skuId']])
            pair=(to_tensor(im),{'boxes':torch.tensor(boxes,dtype=torch.float32).reshape(-1,4),'labels':torch.tensor(labels,dtype=torch.int64)})
            (val if item['split']=='validation' else dataset).append(pair)
        if len(dataset)<2 or not val:raise ValueError('At least two training images and one validation image are required.')
        model=make_model(len(classes)).to(DEVICE)
        # Fine-tune proposal and ROI heads. Keep the pretrained visual backbone frozen.
        for param in model.backbone.parameters():param.requires_grad=False
        optimizer=torch.optim.SGD([p for p in model.parameters() if p.requires_grad],lr=.005,momentum=.9,weight_decay=.0005)
        epochs=int(os.getenv('PRODUCTICA_EPOCHS','5'));epochs=max(1,min(epochs,10));losses=[]
        for epoch in range(epochs):
            reload()
            model.train();total=0
            for idx,(im,target) in enumerate(dataset):
                if (d/'cancel').exists():status(jid,status='cancelled',message='Cancelled',progress=0);return
                if time.monotonic()-start>1200:raise RuntimeError('Training reached the 20-minute safety limit. Reduce the dataset size.')
                loss=sum(model([im.to(DEVICE)],[{k:v.to(DEVICE) for k,v in target.items()}]).values())
                if not torch.isfinite(loss):raise RuntimeError('Training loss became invalid. Review the annotations.')
                optimizer.zero_grad();loss.backward();optimizer.step();total+=float(loss.detach())
            losses.append(total/len(dataset));status(jid,status='running',progress=10+int(65*(epoch+1)/epochs),message=f'Training pass {epoch+1} of {epochs}')
        model.eval();preds=[];truth=[]
        with torch.inference_mode():
            for im,t in val:
                pred=model([im.to(DEVICE)])[0];preds.append({k:v.cpu().tolist() for k,v in pred.items()});truth.append({k:v.tolist() for k,v in t.items()})
        status(jid,progress=90,message='Evaluating held-out images');metrics=evaluate(preds,truth,classes)
        benchmark=[{'id':i['id'],'boxes':i['boxes']} for i in payload['images'] if i['split']=='validation'];metrics.update(benchmark=hashlib.sha256(json.dumps(sorted(benchmark,key=lambda x:x['id']),sort_keys=True).encode()).hexdigest(),loss=losses,trainingImages=len(dataset),epochs=epochs)
        torch.save({'state':model.cpu().state_dict(),'classes':classes,'architecture':'fasterrcnn_mobilenet_v3_large_320_fpn','metrics':metrics},d/'model.pt');commit()
        status(jid,status='complete',progress=100,message='Training complete',metrics=metrics)
    except Exception as exc:status(jid,status='failed',message=str(exc)[:400],progress=0)

def submit_job(payload):POOL.submit(train,payload)
@app.get('/health',dependencies=[Depends(auth)])
def health():return {'ok':True,'device':DEVICE,'engine':'Faster R-CNN MobileNet V3'}
class JobInput(BaseModel):
    id:str
    classes:list[dict[str,Any]]=Field(min_length=1,max_length=50)
    images:list[dict[str,Any]]=Field(min_length=3,max_length=200)
@app.post('/jobs',dependencies=[Depends(auth)])
def create_job(payload:JobInput):
    d=folder(payload.id)
    if d.exists():return {'id':payload.id,'status':json.loads((d/'status.json').read_text())['status']}
    for item in payload.images:
        if item.get('split') not in ('train','validation'):raise HTTPException(400,'Invalid split.')
        for a in item.get('boxes',[]):
            if not all(isinstance(a.get(k),(int,float)) and np.isfinite(a[k]) and 0<=a[k]<=1 for k in ('x','y','w','h')) or a['w']<=0 or a['h']<=0 or a['x']+a['w']>1.0001 or a['y']+a['h']>1.0001:raise HTTPException(400,'Invalid box.')
    status(payload.id,status='queued',progress=0,message='Waiting for training');submit_job(payload.model_dump());return {'id':payload.id,'status':'queued'}
@app.get('/jobs/{jid}',dependencies=[Depends(auth)])
def get_job(jid:str):
    reload();f=folder(jid)/'status.json'
    if not f.exists():raise HTTPException(404,'Training job not found.')
    return json.loads(f.read_text())
@app.post('/jobs/{jid}/cancel',dependencies=[Depends(auth)])
def cancel(jid:str):
    d=folder(jid)
    if not d.exists():raise HTTPException(404,'Training job not found.')
    (d/'cancel').touch();commit();return {'ok':True}
@app.get('/models/{jid}/export',dependencies=[Depends(auth)])
def export(jid:str):
    reload();p=folder(jid)/'model.pt'
    if not p.exists():raise HTTPException(404,'Model not found.')
    return FileResponse(p,filename=f'productica-{jid}.pt')
class ImageInput(BaseModel):image:str=Field(max_length=5_000_000)
@app.post('/models/{jid}/predict',dependencies=[Depends(auth)])
def predict(jid:str,payload:ImageInput):
    reload();p=folder(jid)/'model.pt'
    if not p.exists():raise HTTPException(404,'Model not found.')
    try:im=decode(payload.image)
    except Exception:raise HTTPException(400,'Invalid image.')
    data=torch.load(p,map_location='cpu',weights_only=True);model=make_model(len(data['classes']),False);model.load_state_dict(data['state']);model.to(DEVICE).eval()
    with torch.inference_mode():r=model([to_tensor(im).to(DEVICE)])[0]
    out=[];w,h=im.size
    for box,label,score in zip(r['boxes'].cpu().tolist(),r['labels'].cpu().tolist(),r['scores'].cpu().tolist()):
        if score<.3:continue
        c=data['classes'][label-1];out.append({'skuId':c['id'],'name':c['name'],'score':score,'x':max(0,box[0]/w),'y':max(0,box[1]/h),'w':(box[2]-box[0])/w,'h':(box[3]-box[1])/h})
    return {'predictions':out,'modelId':jid,'threshold':.3}
@app.post('/suggest',dependencies=[Depends(auth)])
def suggest(payload:ImageInput):
    try:im=decode(payload.image)
    except Exception:raise HTTPException(400,'Invalid image.')
    m=make_model().to(DEVICE).eval()
    with torch.inference_mode():p=m([to_tensor(im).to(DEVICE)])[0]
    categories=FasterRCNN_MobileNet_V3_Large_320_FPN_Weights.DEFAULT.meta['categories'];w,h=im.size;out=[]
    for b,l,s in zip(p['boxes'].cpu().tolist(),p['labels'].cpu().tolist(),p['scores'].cpu().tolist()):
        if s>=.5:out.append({'x':b[0]/w,'y':b[1]/h,'w':(b[2]-b[0])/w,'h':(b[3]-b[1])/h,'object':categories[l],'score':s})
    return {'boxes':out,'note':'General object suggestions. Assign each box to the correct SKU before approving.'}
