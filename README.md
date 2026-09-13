# Productica

Customer-owned product recognition: **Upload → Label → Train → Test → Deploy → Improve.**

A functioning first MVP for retail / CPG recognition. The full pipeline runs locally with real pretrained-model fine-tuning. The private hosted web app stores images and annotations; cloud training and inference require a separately deployed recognition worker. No cloud compute account or billing is configured in this repository.

## What works

- Sign-in, owner-scoped workspaces and projects, persistent private image uploads and SKU catalogues.
- Bounding-box annotation, general-object AI suggestions, human approval and separate training / validation sets.
- Actual training jobs, progress, model versions, mAP, precision, recall, per-SKU metrics and confusion matrix.
- Image inference with boxes and product counts; return predictions to the review queue.
- Model promotion requires a better mAP on the same validation benchmark when replacing production.
- Downloadable PyTorch checkpoints and project-key inference endpoint.
- Private, shared and commercial Recognition Packs. Shared activation records accepted terms; commercial activation requires contributor approval. Reuse grants inference access, never access to the contributor's raw photos or checkpoint.
- Hashed, rotatable project keys, ownership checks, request validation and usage records.

The logo and navy / lime colours come from the supplied Productica brand artwork.

## Run locally

Requirements: Node.js 22.13+ with npm; Python 3.11 or 3.12; macOS or Linux. A CPU is sufficient for a small initial experiment. The Python dependencies and first pretrained-weight download require internet access and several GB of disk space. Windows setup paths are provided but have not been tested.

```sh
git clone https://github.com/lukadzagania95/productica.git
cd productica
npm ci
npm run setup:local
```

The setup creates ignored `.env` and `.dev.vars` files with a random worker credential, a Python virtual environment, and local database tables. Existing environment files are preserved. If Python 3.11/3.12 is not your default, set `PRODUCTICA_PYTHON` to its executable when running setup.

Run these in two separate terminals from this directory:

```sh
npm run worker
```

```sh
npm run dev
```

Open **http://localhost:5173** and follow the local sign-in. Development uses a localhost-only test identity. Hosted sign-in is handled by the Sites gateway; the local identity middleware is not included in the production build. Keep the development server bound to localhost.

Data persists under `.wrangler/state`. Model checkpoints persist under `worker/models`. These folders and all credentials are ignored by Git. Keep both processes running while using the full local app.

## First real catalogue

1. Create a workspace and project, then add the exact SKU names.
2. Upload varied product or shelf photos. Open each image, draw boxes and assign its SKUs. AI suggestions propose general objects; you confirm the exact SKU.
3. Reserve independent photos as **Validation** and approve labels. Every SKU must appear in both sets. The technical minimum is two training images and one validation image, but this only proves the workflow: real recognition needs a larger, varied and representative dataset.
4. Select **Train & evaluate → Train a model**. Inspect per-SKU errors, not only the headline score.
5. Test unseen photos, promote a model and optionally publish a Recognition Pack.
6. Send difficult photos to review, correct their labels, and retrain. Keep the validation set fixed when comparing candidates.

For a reproducible pipeline exercise, while both servers are running:

```sh
npm run test:smoke
```

This creates a clearly named QA workspace, four synthetic product images, a real trained model and a reusable pack. These synthetic results are not a real SKU accuracy benchmark.

## Architecture

| Layer | Implementation |
| --- | --- |
| Web interface | React / TypeScript, Next-style routes through Vinext, Shadcn components |
| Web backend | Cloudflare Workers-compatible routes; D1 for metadata and R2 for private images |
| Recognition worker | FastAPI + PyTorch / Torchvision, authenticated HTTP job interface |
| Starting model | COCO-pretrained Faster R-CNN MobileNet V3 320; frozen backbone with trained proposal / detection heads |
| Model storage | Local model directory, or a persistent Modal volume when that adapter is deployed |
| Authentication | Sites-managed ChatGPT sign-in in hosting; scoped test identity in local development |

The web backend calls `/jobs`, `/jobs/{id}`, `/models/{id}/predict`, `/models/{id}/export` and `/suggest`. Replacing the provider does not change the customer workflow. Worker credentials stay on the server. Job inputs are transferred to the worker for training and held in memory; raw photos are not written into model exports. Training-data privacy is an access-control property, not a claim of formal differential privacy.

## Connect a cloud worker

The included `worker/modal_service.py` is a deployment adapter, **not a deployed or cloud-validated service**. It needs your Modal account and spending approval. It requests a T4 for the API and training functions with one container per function; this is a concurrency limit, not a hard spending cap.

1. Install / authenticate the official Modal CLI in a separate environment.
2. Create a Modal secret named `productica-worker` containing `TRAINING_WORKER_KEY` using the provider's secret UI. Use a strong random value and keep it out of shell history and Git.
3. Deploy `modal deploy worker/modal_service.py` and copy the returned API URL.
4. Configure the hosted site's server environment with `TRAINING_WORKER_URL` and the same secret `TRAINING_WORKER_KEY`. For local use with a remote worker, set these values in both ignored environment files.
5. Verify the authenticated `/health` endpoint and run the full smoke workflow against the deployment before onboarding other users.

The Dockerfile is an alternative for an existing server; mount persistent storage at the configured `PRODUCTICA_MODELS_DIR`. Never expose the local development sign-in on the internet.

## Inference API

Create a key under **Deploy & share**, and promote a model. On the local app:

```http
POST http://localhost:5173/api/infer
Authorization: Bearer YOUR_PROJECT_KEY
Content-Type: application/json

{"image":"BASE64_JPEG_OR_PNG"}
```

To use an activated pack, also include `"packId":"PACK_ID"`. The response includes normalized boxes, SKU names, scores and the model ID. The owner-only hosted preview also requires the Sites access gateway's authentication; a project key alone does not bypass that gateway. Browser testing works after sign-in; standalone integrations should use the local endpoint until a dedicated service endpoint is deployed.

Exports are `.pt` checkpoints containing `state`, `classes`, `architecture` and `metrics`. Load only your own trusted exports with `torch.load(..., weights_only=True)` and construct the same detector using `worker/app.py`.

## Validation

```sh
npm run typecheck
npm run build
npm run test:metrics
npm run test:smoke
npm run test:security
```

The initial local run passed upload, annotation, real training, held-out evaluation, promotion, inference, export and pack reuse without training-image transfer. Metric unit tests cover perfect predictions, wrong-class matches, duplicate detections and misses. Security checks cover cross-owner isolation, private images and models, license approval, spoofed identity headers, CSRF and invalid API credentials. CI checks TypeScript and the web build on pushes and pull requests.

Database schema changes: edit `db/schema.ts`, run `npm run db:generate`, review the generated migration, and apply it locally through `npm run setup:local`. Hosting includes generated migrations in the deployment artifact.

## Deliberate MVP limits

- Up to 200 images and 50 SKUs per project, 3 MB per uploaded image and 24 MB of reviewed images per training run. The browser resizes images to 1600 pixels on the long edge.
- Five training passes by default; an internal worker setting allows 1–10. Training has a 20-minute limit. This is an initial detector configuration, not automatic architecture search or a SKU foundation model.
- One owner per workspace; team invitations / roles are not implemented.
- Recognition and visible counts work. Share of shelf, planograms, out-of-stock reasoning, unknown-SKU detection and video ingestion are not implemented.
- Improvement is user-triggered. There is no unattended production-image ingestion or automatic promotion.
- Commercial licenses are manually approved. Payments, contributor payouts, subscriptions, credit exchange, revocation workflows and legal-policy automation are not implemented.
- No production SLA, distributed training scheduler, managed backup policy or service-level rate limiting yet. Obtain real held-out catalogue results and validate isolation in the hosted environment before a multi-customer launch.

## References and attribution

- [Torchvision detector documentation](https://docs.pytorch.org/vision/0.22/models/generated/torchvision.models.detection.fasterrcnn_mobilenet_v3_large_320_fpn.html)
- [Modal volume consistency and lifecycle](https://modal.com/docs/guide/volumes)
- Existing vendored Sites build helpers retain their upstream license in `build/sites-vite-plugin.LICENSE`.

Productica application source and supplied brand artwork are private. No open-source license is granted by this repository. Third-party packages and pretrained weights remain subject to their respective terms.
