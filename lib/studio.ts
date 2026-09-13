import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function db() {
  if (!env.DB)
    throw new ApiError(
      503,
      "Storage is temporarily unavailable. Please retry.",
    );
  return env.DB;
}
export function bucket() {
  if (!env.BUCKET)
    throw new ApiError(503, "Image storage is temporarily unavailable.");
  return env.BUCKET;
}
export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export async function one(sql: string, ...args: any[]) {
  return db()
    .prepare(sql)
    .bind(...args)
    .first<any>();
}
export async function all(sql: string, ...args: any[]) {
  return (
    await db()
      .prepare(sql)
      .bind(...args)
      .all<any>()
  ).results;
}
export async function run(sql: string, ...args: any[]) {
  return db()
    .prepare(sql)
    .bind(...args)
    .run();
}
export function text(v: any, max = 120) {
  if (typeof v !== "string" || !v.trim() || v.trim().length > max)
    throw new ApiError(400, `Enter text between 1 and ${max} characters.`);
  return v.trim();
}
export async function user() {
  let u = await getChatGPTUser();
  if (!u) throw new ApiError(401, "Sign in to use your workspace.");
  return u;
}
export async function project(pid: string, uid: string) {
  let p = await one(
    "SELECT p.* FROM projects p JOIN workspaces w ON w.id=p.workspace_id WHERE p.id=? AND w.owner=?",
    pid,
    uid,
  );
  if (!p) throw new ApiError(404, "Project not found.");
  return p;
}
export async function ownedImage(iid: string, uid: string) {
  let im = await one("SELECT * FROM images WHERE id=?", iid);
  if (!im) throw new ApiError(404, "Image not found.");
  await project(im.project_id, uid);
  return im;
}
export function settings() {
  return env as unknown as Record<string, string>;
}
export async function worker(path: string, body?: any) {
  const e = settings();
  if (!e.TRAINING_WORKER_URL || !e.TRAINING_WORKER_KEY)
    throw new ApiError(
      503,
      "Connect the training service to enable model training and predictions.",
    );
  let r: Response;
  try {
    r = await fetch(e.TRAINING_WORKER_URL.replace(/\/$/, "") + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${e.TRAINING_WORKER_KEY}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(
        path.includes("predict") || path.includes("suggest") ? 120000 : 30000,
      ),
    });
  } catch {
    throw new ApiError(
      503,
      "The training service is not reachable. Please retry.",
    );
  }
  if (!r.ok) {
    let m = await r.json().catch(() => ({}));
    throw new ApiError(
      r.status >= 500 ? 503 : 400,
      (m as any).detail ||
        "The training service could not complete this request.",
    );
  }
  return r;
}
export async function digest(bytes: ArrayBuffer) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}
export function b64(bytes: ArrayBuffer) {
  let b = new Uint8Array(bytes),
    s = "";
  for (let i = 0; i < b.length; i += 32768)
    s += String.fromCharCode(...b.subarray(i, i + 32768));
  return btoa(s);
}
export async function syncJob(j: any) {
  if (!["queued", "running"].includes(j.status)) return j;
  let state: any;
  try {
    state = await (await worker(`/jobs/${j.id}`)).json();
  } catch (e) {
    if (Date.now() - Date.parse(j.updated) > 30 * 60 * 1000) {
      await run(
        "UPDATE jobs SET status=?, message=?, updated=? WHERE id=?",
        "failed",
        "Training service disconnected. Start a new job after reconnecting.",
        now(),
        j.id,
      );
    }
    throw e;
  }
  await run(
    "UPDATE jobs SET status=?,progress=?,message=?,metrics=?,updated=? WHERE id=?",
    state.status,
    state.progress || 0,
    state.message || "",
    state.metrics ? JSON.stringify(state.metrics) : null,
    now(),
    j.id,
  );
  return { ...j, ...state };
}
export function csrf(r: Request) {
  const o = r.headers.get("Origin");
  if (o && o !== new URL(r.url).origin)
    throw new ApiError(403, "Cross-origin requests are not allowed.");
  if (r.headers.get("Sec-Fetch-Site") === "cross-site")
    throw new ApiError(403, "Cross-site requests are not allowed.");
}
export function responseError(e: unknown) {
  if (e instanceof ApiError)
    return Response.json({ error: e.message }, { status: e.status });
  console.error("Studio request failed", e);
  return Response.json(
    { error: "The request could not be saved. Please retry." },
    { status: 500 },
  );
}
export async function resolveModel(
  pid: string,
  uid: string,
  jobId?: string,
  packId?: string,
) {
  await project(pid, uid);
  if (packId) {
    const l = await one(
      "SELECT k.job_id,k.id AS pack_id FROM licenses l JOIN packs k ON k.id=l.pack_id WHERE l.project_id=? AND l.pack_id=? AND l.status=?",
      pid,
      packId,
      "approved",
    );
    if (!l) throw new ApiError(403, "An active pack license is required.");
    return { jobId: l.job_id, packId: l.pack_id };
  }
  const p = await project(pid, uid);
  let j = await one(
    "SELECT * FROM jobs WHERE id=? AND project_id=? AND status=?",
    jobId || p.production_job,
    pid,
    "complete",
  );
  if (!j) throw new ApiError(400, "Select a completed model first.");
  return { jobId: j.id, packId: null };
}
