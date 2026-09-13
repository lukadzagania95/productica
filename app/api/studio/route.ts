import {
  ApiError,
  all,
  b64,
  bucket,
  csrf,
  db,
  digest,
  id,
  now,
  one,
  ownedImage,
  project,
  resolveModel,
  responseError,
  run,
  settings,
  syncJob,
  text,
  user,
  worker,
} from "@/lib/studio";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const u = await user(),
      q = new URL(req.url).searchParams,
      kind = q.get("kind") || "state";
    if (kind === "image") {
      let im = await ownedImage(q.get("id") || "", u.userId),
        o = await bucket().get(im.key);
      if (!o) throw new ApiError(404, "Image missing.");
      return new Response(o.body, {
        headers: {
          "Content-Type": o.httpMetadata?.contentType || "image/jpeg",
          "Cache-Control": "private, max-age=60",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (kind === "job") {
      let j = await one("SELECT * FROM jobs WHERE id=?", q.get("id"));
      if (!j) throw new ApiError(404, "Job not found.");
      await project(j.project_id, u.userId);
      return Response.json(await syncJob(j));
    }
    if (kind === "export") {
      let j = await one(
        "SELECT * FROM jobs WHERE id=? AND status=?",
        q.get("id"),
        "complete",
      );
      if (!j) throw new ApiError(404, "Model not found.");
      await project(j.project_id, u.userId);
      let r = await worker(`/models/${j.id}/export`);
      return new Response(r.body, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="productica-${j.id}.pt"`,
          "Cache-Control": "no-store",
        },
      });
    }
    if (kind === "dataset") {
      let pid = q.get("project") || "";
      await project(pid, u.userId);
      return Response.json(
        {
          classes: await all("SELECT * FROM skus WHERE project_id=?", pid),
          images: await all(
            "SELECT id,name,width,height,split,reviewed,annotations FROM images WHERE project_id=?",
            pid,
          ),
        },
        {
          headers: {
            "Content-Disposition": 'attachment; filename="annotations.json"',
          },
        },
      );
    }
    if (kind !== "state") throw new ApiError(404, "Not found.");
    const workspaces = await all(
        "SELECT * FROM workspaces WHERE owner=? ORDER BY created",
        u.userId,
      ),
      projects = await all(
        "SELECT p.* FROM projects p JOIN workspaces w ON p.workspace_id=w.id WHERE w.owner=? ORDER BY p.created DESC",
        u.userId,
      );
    let pid = q.get("project");
    if (pid) await project(pid, u.userId);
    const packs = await all(
      "SELECT k.*,j.metrics,j.classes FROM packs k JOIN jobs j ON j.id=k.job_id WHERE k.owner=? OR k.visibility IN (?,?) ORDER BY k.created DESC",
      u.userId,
      "shared",
      "marketplace",
    );
    return Response.json(
      {
        user: { id: u.userId, email: u.email, name: u.displayName },
        workspaces,
        projects,
        skus: pid
          ? await all(
              "SELECT * FROM skus WHERE project_id=? ORDER BY name",
              pid,
            )
          : [],
        images: pid
          ? await all(
              "SELECT id,project_id,name,width,height,split,reviewed,annotations,created FROM images WHERE project_id=? ORDER BY created DESC",
              pid,
            )
          : [],
        jobs: pid
          ? await all(
              "SELECT * FROM jobs WHERE project_id=? ORDER BY created DESC",
              pid,
            )
          : [],
        packs,
        licenses: await all(
          "SELECT l.*,k.name AS pack_name,k.owner AS contributor,k.job_id FROM licenses l JOIN packs k ON k.id=l.pack_id WHERE l.owner=? OR k.owner=?",
          u.userId,
          u.userId,
        ),
        usage: pid
          ? (
              await one(
                "SELECT COUNT(*) AS count FROM usage WHERE project_id=?",
                pid,
              )
            ).count
          : 0,
        workerConfigured: !!(
          settings().TRAINING_WORKER_URL && settings().TRAINING_WORKER_KEY
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return responseError(e);
  }
}
export async function POST(req: Request) {
  try {
    csrf(req);
    const u = await user();
    if (+(req.headers.get("content-length") || 0) > 12 * 1024 * 1024)
      throw new ApiError(413, "Request too large.");
    let b: any;
    if (req.headers.get("Content-Type")?.startsWith("multipart/form-data")) {
      const f = await req.formData(),
        pid = String(f.get("projectId"));
      await project(pid, u.userId);
      const file = f.get("file");
      if (
        !(file instanceof File) ||
        file.size > 3 * 1024 * 1024 ||
        file.size === 0
      )
        throw new ApiError(400, "Upload a JPEG or PNG under 3 MB.");
      let bytes = await file.arrayBuffer(),
        v = new Uint8Array(bytes);
      const mime =
        v[0] === 255 && v[1] === 216
          ? "image/jpeg"
          : v[0] === 137 && v[1] === 80 && v[2] === 78 && v[3] === 71
            ? "image/png"
            : null;
      if (!mime)
        throw new ApiError(400, "Only JPEG and PNG images are supported.");
      const n = await one(
        "SELECT COUNT(*) AS n FROM images WHERE project_id=?",
        pid,
      );
      if (n.n >= 200)
        throw new ApiError(
          400,
          "This MVP supports up to 200 images per project.",
        );
      let width = Number(f.get("width")),
        height = Number(f.get("height"));
      if (
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width < 1 ||
        height < 1 ||
        width > 4096 ||
        height > 4096
      )
        throw new ApiError(400, "Invalid image dimensions.");
      const hash = await digest(bytes),
        duplicate = await one(
          "SELECT id FROM images WHERE project_id=? AND digest=?",
          pid,
          hash,
        );
      if (duplicate)
        return Response.json({ id: duplicate.id, duplicate: true });
      let iid = id(),
        key = `images/${u.userId}/${pid}/${iid}`;
      await bucket().put(key, bytes, { httpMetadata: { contentType: mime } });
      try {
        await run(
          "INSERT INTO images(id,project_id,name,key,width,height,created,digest) VALUES(?,?,?,?,?,?,?,?)",
          iid,
          pid,
          file.name.slice(0, 160),
          key,
          width,
          height,
          now(),
          hash,
        );
      } catch (e) {
        await bucket().delete(key);
        throw e;
      }
      return Response.json({ id: iid });
    }
    b = await req.json();
    const action = b.action;
    if (action === "workspace") {
      const wid = id();
      await run(
        "INSERT INTO workspaces VALUES(?,?,?,?)",
        wid,
        u.userId,
        text(b.name),
        now(),
      );
      return Response.json({ id: wid });
    }
    if (action === "project") {
      const w = await one(
        "SELECT * FROM workspaces WHERE id=? AND owner=?",
        b.workspaceId,
        u.userId,
      );
      if (!w) throw new ApiError(404, "Workspace not found.");
      let pid = id();
      await run(
        "INSERT INTO projects(id,workspace_id,name,created) VALUES(?,?,?,?)",
        pid,
        w.id,
        text(b.name),
        now(),
      );
      return Response.json({ id: pid });
    }
    if (action === "approveLicense") {
      let l = await one(
        "SELECT l.id FROM licenses l JOIN packs k ON k.id=l.pack_id WHERE l.id=? AND k.owner=?",
        b.id,
        u.userId,
      );
      if (!l) throw new ApiError(404, "License not found.");
      await run("UPDATE licenses SET status=? WHERE id=?", "approved", b.id);
      return Response.json({ ok: true });
    }
    const pid = text(b.projectId, 80);
    await project(pid, u.userId);
    if (action === "sku") {
      let sid = id();
      try {
        await run(
          "INSERT INTO skus VALUES(?,?,?,?)",
          sid,
          pid,
          text(b.name),
          /^#[a-fA-F0-9]{6}$/.test(b.color) ? b.color : "#afd253",
        );
      } catch {
        throw new ApiError(400, "A SKU with that name already exists.");
      }
      return Response.json({ id: sid });
    }
    if (action === "annotations") {
      let im = await ownedImage(b.imageId, u.userId);
      if (im.project_id !== pid)
        throw new ApiError(400, "Image belongs to another project.");
      let classes = await all("SELECT id FROM skus WHERE project_id=?", pid);
      if (!Array.isArray(b.boxes) || b.boxes.length > 200)
        throw new ApiError(400, "Invalid labels.");
      for (let a of b.boxes) {
        if (
          !classes.some((c) => c.id === a.skuId) ||
          !["x", "y", "w", "h"].every(
            (k) =>
              typeof a[k] === "number" &&
              Number.isFinite(a[k]) &&
              a[k] >= 0 &&
              a[k] <= 1,
          ) ||
          a.w <= 0 ||
          a.h <= 0 ||
          a.x + a.w > 1.0001 ||
          a.y + a.h > 1.0001
        )
          throw new ApiError(
            400,
            "Each box must be inside the image and assigned to a SKU.",
          );
      }
      if (!["train", "validation"].includes(b.split))
        throw new ApiError(400, "Invalid dataset split.");
      await run(
        "UPDATE images SET annotations=?,reviewed=?,split=? WHERE id=?",
        JSON.stringify(b.boxes),
        b.reviewed ? 1 : 0,
        b.split,
        im.id,
      );
      return Response.json({ ok: true });
    }
    if (action === "deleteImage") {
      const im = await ownedImage(b.imageId, u.userId);
      if (im.project_id !== pid) throw new ApiError(403, "Wrong project.");
      await run("DELETE FROM images WHERE id=?", im.id);
      await bucket().delete(im.key);
      return Response.json({ ok: true });
    }
    if (action === "suggest") {
      const im = await ownedImage(b.imageId, u.userId);
      if (im.project_id !== pid) throw new ApiError(403, "Wrong project.");
      const object = await bucket().get(im.key);
      if (!object) throw new ApiError(404, "Image missing.");
      return Response.json(
        await (
          await worker("/suggest", { image: b64(await object.arrayBuffer()) })
        ).json(),
      );
    }
    if (action === "train") {
      if (!settings().TRAINING_WORKER_URL)
        throw new ApiError(
          503,
          "Connect the training service to start real model training.",
        );
      if (
        await one(
          "SELECT id FROM jobs WHERE project_id=? AND status IN (?,?)",
          pid,
          "queued",
          "running",
        )
      )
        throw new ApiError(409, "A training job is already running.");
      let classes = await all(
          "SELECT * FROM skus WHERE project_id=? ORDER BY id",
          pid,
        ),
        ims = await all(
          "SELECT * FROM images WHERE project_id=? AND reviewed=1",
          pid,
        );
      if (classes.length < 1 || classes.length > 50)
        throw new ApiError(400, "Add between 1 and 50 SKUs.");
      let train = ims.filter((i) => i.split === "train"),
        val = ims.filter((i) => i.split === "validation");
      if (train.length < 2 || val.length < 1)
        throw new ApiError(
          400,
          "Review at least two training images and one separate validation image.",
        );
      for (let c of classes) {
        if (
          !train.some((i) =>
            JSON.parse(i.annotations).some((a: any) => a.skuId === c.id),
          )
        )
          throw new ApiError(400, `Add training labels for ${c.name}.`);
        if (
          !val.some((i) =>
            JSON.parse(i.annotations).some((a: any) => a.skuId === c.id),
          )
        )
          throw new ApiError(400, `Add validation labels for ${c.name}.`);
      }
      let totalBytes = 0;
      for (let im of ims) {
        let head = await bucket().head(im.key);
        totalBytes += head?.size || 0;
      }
      if (totalBytes > 24 * 1024 * 1024)
        throw new ApiError(
          400,
          "This training run exceeds 24 MB. Use smaller images or fewer reviewed photos.",
        );
      let jid = id(),
        items = [];
      for (let im of ims) {
        let o = await bucket().get(im.key);
        if (!o) throw new ApiError(400, "A dataset image is missing.");
        items.push({
          id: im.id,
          image: b64(await o.arrayBuffer()),
          split: im.split,
          boxes: JSON.parse(im.annotations),
        });
      }
      let ts = now();
      await run(
        "INSERT INTO jobs(id,project_id,status,created,updated,classes,snapshot) VALUES(?,?,?,?,?,?,?)",
        jid,
        pid,
        "queued",
        ts,
        ts,
        JSON.stringify(classes),
        JSON.stringify(
          ims.map((i) => ({
            id: i.id,
            split: i.split,
            annotations: JSON.parse(i.annotations),
          })),
        ),
      );
      try {
        await worker("/jobs", { id: jid, classes, images: items });
      } catch (e) {
        await run(
          "UPDATE jobs SET status=?,message=? WHERE id=?",
          "failed",
          e instanceof Error ? e.message : "Unable to start",
          jid,
        );
        throw e;
      }
      return Response.json({ id: jid });
    }
    if (action === "cancel") {
      let j = await one(
        "SELECT * FROM jobs WHERE id=? AND project_id=?",
        b.jobId,
        pid,
      );
      if (!j) throw new ApiError(404, "Job missing.");
      await worker(`/jobs/${j.id}/cancel`, {});
      await run(
        "UPDATE jobs SET status=?,message=? WHERE id=?",
        "cancelled",
        "Cancelled by you.",
        j.id,
      );
      return Response.json({ ok: true });
    }
    if (action === "promote") {
      let j = await one(
        "SELECT * FROM jobs WHERE id=? AND project_id=? AND status=?",
        b.jobId,
        pid,
        "complete",
      );
      if (!j || !j.metrics)
        throw new ApiError(400, "A completed, evaluated model is required.");
      let p = await project(pid, u.userId);
      if (p.production_job) {
        let old = await one("SELECT * FROM jobs WHERE id=?", p.production_job);
        if (old?.metrics) {
          let a = JSON.parse(old.metrics),
            m = JSON.parse(j.metrics);
          if (a.benchmark !== m.benchmark)
            throw new ApiError(
              400,
              "Use the same validation images and labels to compare models.",
            );
          if (m.map <= a.map)
            throw new ApiError(
              400,
              "The candidate must improve mAP before replacing production.",
            );
        }
      }
      await run("UPDATE projects SET production_job=? WHERE id=?", j.id, pid);
      return Response.json({ ok: true });
    }
    if (action === "predict") {
      if (typeof b.image !== "string" || b.image.length > 5e6)
        throw new ApiError(400, "Upload a smaller image.");
      const m = await resolveModel(pid, u.userId, b.jobId, b.packId),
        result = (await (
          await worker(`/models/${m.jobId}/predict`, { image: b.image })
        ).json()) as any;
      await run(
        "INSERT INTO usage VALUES(?,?,?,?,?,?)",
        id(),
        pid,
        m.jobId,
        m.packId,
        now(),
        result.predictions.length,
      );
      return Response.json(result);
    }
    if (action === "publish") {
      let j = await one(
        "SELECT * FROM jobs WHERE id=? AND project_id=? AND status=?",
        b.jobId,
        pid,
        "complete",
      );
      if (!j) throw new ApiError(400, "Complete a training job first.");
      if (
        !["private", "shared", "marketplace"].includes(b.visibility) ||
        b.consent !== true
      )
        throw new ApiError(400, "Confirm ownership and select a sharing mode.");
      let pack = id();
      await run(
        "INSERT INTO packs VALUES(?,?,?,?,?,?,?,?,?)",
        pack,
        u.userId,
        pid,
        j.id,
        text(b.name),
        typeof b.description === "string" ? b.description.slice(0, 600) : "",
        b.visibility,
        text(b.terms, 1000),
        now(),
      );
      return Response.json({ id: pack });
    }
    if (action === "activate") {
      let k = await one("SELECT * FROM packs WHERE id=?", b.packId);
      if (!k || (k.visibility === "private" && k.owner !== u.userId))
        throw new ApiError(404, "Pack not found.");
      if (b.acceptTerms !== true)
        throw new ApiError(400, "Accept the license terms to continue.");
      let status =
        k.visibility === "marketplace" && k.owner !== u.userId
          ? "requested"
          : "approved";
      await run(
        "INSERT INTO licenses VALUES(?,?,?,?,?,?,?) ON CONFLICT(pack_id,project_id) DO NOTHING",
        id(),
        k.id,
        pid,
        u.userId,
        status,
        k.terms,
        now(),
      );
      return Response.json({ status });
    }
    if (action === "apiKey") {
      const key = `pdt_${id().replaceAll("-", "")}${id().replaceAll("-", "")}`,
        hash = await digest(new TextEncoder().encode(key).buffer);
      await db().batch([
        db().prepare("DELETE FROM api_keys WHERE project_id=?").bind(pid),
        db()
          .prepare("INSERT INTO api_keys VALUES(?,?,?,?)")
          .bind(id(), pid, hash, now()),
      ]);
      return Response.json({ key });
    }
    throw new ApiError(400, "Unknown action.");
  } catch (e) {
    return responseError(e);
  }
}
