"""Deploy with: modal deploy worker/modal_service.py. Requires a Modal account."""
import os
from pathlib import Path
import modal
image=modal.Image.debian_slim(python_version='3.11').pip_install_from_requirements(str(Path(__file__).with_name('requirements.txt'))).add_local_file(str(Path(__file__).with_name('app.py')),'/root/productica_worker.py')
service=modal.App('productica-recognition')
volume=modal.Volume.from_name('productica-models',create_if_missing=True)
secret=modal.Secret.from_name('productica-worker',required_keys=['TRAINING_WORKER_KEY'])
def setup():
    os.environ['PRODUCTICA_MODELS_DIR']='/models'
    os.environ['PRODUCTICA_DISTRIBUTED']='1'
    import productica_worker as worker
    worker.commit=volume.commit
    worker.reload=volume.reload
    return worker
@service.function(image=image,gpu='T4',volumes={'/models':volume},secrets=[secret],timeout=1500,max_containers=1)
def train_remote(payload):setup().train(payload)
@service.function(image=image,gpu='T4',volumes={'/models':volume},secrets=[secret],timeout=300,max_containers=1,scaledown_window=60)
@modal.asgi_app()
def api():
    worker=setup()
    worker.submit_job=lambda payload:train_remote.spawn(payload)
    return worker.app
