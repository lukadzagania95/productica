"""SKU deletion regression against the local app and real local training worker."""
import http.cookiejar
import io
import json
import time
import urllib.error
import urllib.request
import uuid
from PIL import Image

BASE = 'http://localhost:5173'
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
client.open(BASE + '/signin-with-chatgpt?return_to=/').read()


def post(data, expected=200):
    req = urllib.request.Request(BASE + '/api/studio', data=json.dumps(data).encode(),
                                 headers={'Content-Type': 'application/json', 'Origin': BASE})
    try:
        with client.open(req, timeout=120) as r:
            status, result = r.status, json.load(r)
    except urllib.error.HTTPError as e:
        status, result = e.code, json.load(e)
    assert status == expected, (status, result)
    return result


def get(path):
    with client.open(BASE + path, timeout=120) as r:
        return json.load(r)


w = post({'action': 'workspace', 'name': 'SKU removal QA ' + uuid.uuid4().hex[:6]})['id']
p = post({'action': 'project', 'workspaceId': w, 'name': 'SKU removal regression'})['id']
other = post({'action': 'project', 'workspaceId': w, 'name': 'Isolation fixture'})['id']


def act(action, expected=200, **fields):
    return post({'action': action, 'projectId': p, **fields}, expected)


keep = act('sku', name='Keep product')['id']
accidental = act('sku', name='Accidental unused SKU')['id']
images = []
box = {'skuId': keep, 'x': 0, 'y': 0, 'w': 1, 'h': 1}
for i in range(3):
    stream = io.BytesIO()
    Image.new('RGB', (320, 320), (150 + i * 30, 210, 83)).save(stream, format='JPEG')
    boundary = 'qa-' + uuid.uuid4().hex
    body = b''
    for key, val in [('projectId', p), ('width', '320'), ('height', '320')]:
        body += f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{val}\r\n'.encode()
    body += (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="sku-qa-{i}.jpg"\r\n'
             'Content-Type: image/jpeg\r\n\r\n').encode() + stream.getvalue() + f'\r\n--{boundary}--\r\n'.encode()
    req = urllib.request.Request(BASE + '/api/studio', data=body,
                                 headers={'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Origin': BASE})
    with client.open(req) as r:
        iid = json.load(r)['id']
    images.append(iid)
    act('annotations', imageId=iid, boxes=[box], split='validation' if i == 2 else 'train', reviewed=True)

blocked = act('train', 400)
assert 'Accidental unused SKU' in blocked['error'], blocked
act('deleteSku', 404, projectId=other, skuId=accidental)
act('deleteSku', 404, projectId=str(uuid.uuid4()), skuId=accidental)
act('deleteSku', skuId=accidental)
act('deleteSku', 404, skuId=accidental)
state = get('/api/studio?project=' + p)
assert [s['id'] for s in state['skus']] == [keep]
assert all(i['reviewed'] and json.loads(i['annotations']) == [box] for i in state['images'])
job_id = act('train')['id']
print('PASS removing unused SKU unblocks real training; unrelated labels stay reviewed', flush=True)
for _ in range(120):
    job = get('/api/studio?kind=job&id=' + job_id)
    if job['status'] not in ('queued', 'running'):
        break
    time.sleep(2)
assert job['status'] == 'complete', job
original_classes, original_snapshot = job['classes'], job['snapshot']

used = act('sku', name='Remove labeled SKU')['id']
removed_box = {**box, 'skuId': used}
act('annotations', imageId=images[0], boxes=[box, removed_box], split='train', reviewed=True)
act('annotations', imageId=images[1], boxes=[removed_box], split='train', reviewed=True)
act('deleteSku', skuId=used)
state = get('/api/studio?project=' + p)
by_id = {i['id']: i for i in state['images']}
assert json.loads(by_id[images[0]]['annotations']) == [box]
assert json.loads(by_id[images[1]]['annotations']) == []
assert not by_id[images[0]]['reviewed'] and not by_id[images[1]]['reviewed']
assert by_id[images[2]]['reviewed']
act('annotations', 400, imageId=images[0], boxes=[removed_box], split='train', reviewed=True)
act('deleteSku', skuId=keep)
job = get('/api/studio?kind=job&id=' + job_id)
assert job['classes'] == original_classes and job['snapshot'] == original_snapshot
assert len(get('/api/studio?project=' + p)['images']) == 3
assert 'between 1 and 50' in act('train', 400)['error']
print('PASS label cleanup, empty label arrays, review reset, stale labels rejected, model snapshots and photos retained', flush=True)
