# Productica — Solution Concept & Technical Brief

**Audience:** technical collaborator / engineering partner  
**Date:** 15 September 2026  
**Status:** functioning early MVP; broader platform vision described separately below.

## 1. The idea

Productica lets companies build custom product-recognition models without an ML team. A customer uploads product or shelf photos, labels the products, trains a model, and uses it to recognize those products in new images.

The core experience is:

**Upload → Label → Train → Test → Deploy → Improve**

The strategic differentiator is a **Recognition Library / Marketplace**: customers can make selected recognition capabilities reusable by other customers, while retaining control over their training data.

The initial market is **retail / CPG store checks**. The immediate output is SKU detection: which products appear, where they are, and how many visible instances were detected.

## 2. Example customer journey

1. A beverage company creates a project and defines Coca-Cola Regular, Zero and Diet as separate classes.
2. It uploads representative photos and draws a bounding box around each product instance, assigning the correct class. Automatic object suggestions help with annotation; users review them.
3. It reserves independent, labeled photos for validation. Those images measure performance and are not used to update model weights.
4. It starts training. Productica fine-tunes a pretrained detector and reports precision, recall, mAP and per-class errors.
5. It tests fresh photos and promotes a satisfactory model for use.
6. It optionally publishes a recognition pack that another store-check customer can activate.

For a commercial catalogue, classes should distinguish exact variants, sizes, packaging and relevant regional differences. The three-class example is a simplified demonstration.

## 3. Recognition Packs: the reusable asset

A pack represents a versioned recognition capability, with an owner, supported classes, evaluation information and usage terms.

| Mode | Intended behavior | Current MVP |
| --- | --- | --- |
| Private | Only the owner can use the asset. | Owner-restricted access. |
| Shared | Selected capabilities are shared; contributors may receive access benefits or discounts. | Terms acceptance and activation; contribution credits and discounts are future work. |
| Marketplace | Other customers license recognition; contributor and platform share revenue. | License requests and contributor approval; payments and revenue sharing are future work. |

**Example:** a company develops a “Coca-Cola Georgia Recognition Pack” covering 150 SKUs. Another customer licenses it for competitor recognition instead of collecting and labeling those products from scratch. This is an illustrative future catalogue, not an existing asset or a claim that the MVP supports 150 classes per project.

Licensees should receive recognition capability, not another company's raw training images. Currently, a pack points to a completed trained model and grants inference access. It does not expose the contributor's images or checkpoint.

An important engineering distinction: activating several packs does **not** automatically combine their neural-network weights into one detector. Cross-pack inference, class mapping and duplicate-detection handling require additional design. The current inference request selects one model or activated pack.

The intended network effect is:

**More customers → more trained SKUs → larger reusable library → faster onboarding → more customers.**

This depends on pack quality, catalogue compatibility and meaningful coverage; publishing more packs alone does not guarantee useful recognition.

## 4. Current model and training approach

The MVP uses **computer-vision machine learning, not an LLM**, for both object suggestions and custom recognition.

- **Framework:** PyTorch / Torchvision.
- **Detector:** `fasterrcnn_mobilenet_v3_large_320_fpn`, starting from COCO-pretrained weights.
- **Training:** freeze the visual backbone and fine-tune the proposal and detection heads on customer-labeled images.
- **Defaults:** five training passes; internal configuration supports 1–10. Customers do not need to configure ML parameters.
- **Label suggestions:** the general pretrained detector proposes object boxes. It does not already know customer-specific SKUs; users assign and verify those labels.
- **Evaluation:** mAP across IoU thresholds 0.50–0.95, precision, recall, per-class results and a confusion matrix.
- **Export:** a PyTorch `.pt` checkpoint with weights, classes, architecture identifier and metrics.

No foundation model is trained from scratch. Automatic model recommendation is part of the product vision; the current MVP uses this fixed architecture. Its suitability for dense shelves and visually similar SKUs needs representative benchmarking.

## 5. Current architecture

```text
Browser: projects, images, labeling, training status, testing, packs
                             |
                             v
Web API: identity, ownership, project keys, licensing, usage
         |                   |                    |
         v                   v                    v
   D1 metadata DB      R2 private images     Authenticated job API
                                                  |
                                                  v
                                      Modal / FastAPI worker
                                      PyTorch training + inference
                                      Persistent model storage
```

| Layer | Implementation |
| --- | --- |
| Frontend | React, TypeScript, Shadcn components; Next-style routes through Vinext |
| Hosted application | Sites hosting with Cloudflare Workers-compatible backend |
| Metadata and images | D1 database and private R2 object storage |
| ML service | FastAPI, PyTorch and Torchvision deployed on Modal |
| Training infrastructure | Rented cloud compute behind an authenticated training-job interface |
| Identity | Sites-managed sign-in; owner-scoped workspaces and projects |

Core entities are workspaces, projects, SKUs, images and annotations, training jobs/model versions, recognition packs, licenses, API keys and usage records. Training jobs capture dataset/class snapshots for traceability.

Worker endpoints cover job submission/status, predictions, export and label suggestions. The product backend controls authorization and calls the worker using a server-side credential. This boundary allows the compute provider to change without changing the customer workflow.

## 6. Inference and integration

**Training teaches the model; inference applies it to a new image.**

The app can display predictions directly. An integration can submit a base64 image to `POST /api/infer` using a project API key, optionally specifying an activated `packId`.

Each detection contains a SKU identifier/name, confidence score and normalized bounding-box coordinates (`x`, `y`, `w`, `h`). Counts can be calculated from detections; they represent visible detected objects, not inventory behind the shelf front.

**Current integration limitation:** the private hosted prototype also requires Sites sign-in. A project API key alone does not provide unattended external access. A dedicated externally accessible, authenticated service endpoint is needed for standalone customer integrations. Local API use is supported.

## 7. Continuous improvement

The target active-learning loop is:

```text
Production photos → uncertain or incorrect predictions → pre-label
→ human review of difficult examples → train candidate
→ compare against production on a fixed benchmark → approve promotion
```

Today, users can return predictions to the review queue, correct labels and manually retrain. Replacing an existing production model requires a higher mAP on the same validation images and labels.

Automated image ingestion, uncertainty-based sampling and unattended retraining are future work. A stronger production release gate should also check per-SKU regressions, latency and operational requirements. Maintain a separate untouched test set to check generalization beyond the repeatedly used validation set.

## 8. Ownership, consent and licensing

Customer ownership and explicit sharing choices are core product requirements. The implementation includes owner checks, private image access, hashed rotatable project keys, pack-publication consent, accepted license terms and usage records.

Before broader commercial use, extend this with organization roles, auditable consent and rights records, retention/deletion controls, license revocation and expiry, and enforceable billing entitlements. Contributor rights to license a capability must be established; uploading images alone does not establish those rights.

Withholding raw images is an access-control measure, not a guarantee that trained models cannot reveal information about training data.

## 9. MVP boundaries and next priorities

**Working today:** image upload, SKU management, manual annotation, object suggestions, reviewed train/validation sets, real training, evaluation, model versions, test predictions, promotion, export, a project-key API route, and basic pack publishing/licensing/reuse.

**Current limits:** 200 images and 50 SKUs per project; 3 MB per uploaded image; 24 MB of reviewed image data per training run; 20-minute training limit. Workspaces currently have a single owner. Small synthetic tests establish that the pipeline runs; they do not establish real retail accuracy.

**Future retail outputs:** share of shelf, availability/out-of-stock reasoning, planogram compliance, promotional-display recognition and unknown-SKU detection. These require additional logic, suitable data and evaluation; they are not delivered merely by detecting boxes. Video ingestion is also future work.

Recommended engineering sequence:

1. Benchmark a small real catalogue on independent store photos and quantify detection errors.
2. Provide a standalone authenticated inference endpoint, quotas and reliable job/error handling.
3. Add team roles, operational monitoring and backup/recovery practices.
4. Define canonical SKU identities, pack compatibility and cross-pack inference behavior.
5. Build controlled active learning, then billing, contributor payouts and license lifecycle management.

The proposed business model combines platform access, metered training/inference and a share of marketplace licensing revenue. Pricing and revenue splits remain to be defined.

## 10. Project access

- Prototype: https://productica-luka.lukadzagania.chatgpt.site/ — invited access required.
- Source: https://github.com/lukadzagania95/productica — private repository; separate collaborator access required.
- Repository `README.md` contains local setup, service deployment and validation instructions.

This brief describes the concept and the implementation inspected on the date above. It contains no service credentials or customer training data.
