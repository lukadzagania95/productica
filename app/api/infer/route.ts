import {
  ApiError,
  digest,
  one,
  resolveModel,
  responseError,
  worker,
  run,
  id,
  now,
} from "@/lib/studio";
export async function POST(req: Request) {
  try {
    let token = req.headers.get("Authorization")?.replace(/^Bearer /, "");
    if (!token || token.length > 200)
      throw new ApiError(401, "A project API key is required.");
    const hash = await digest(new TextEncoder().encode(token).buffer),
      key = await one(
        "SELECT a.*,w.owner FROM api_keys a JOIN projects p ON p.id=a.project_id JOIN workspaces w ON w.id=p.workspace_id WHERE a.hash=?",
        hash,
      );
    if (!key) throw new ApiError(401, "Invalid API key.");
    if (+(req.headers.get("content-length") || 0) > 5e6)
      throw new ApiError(413, "Image too large.");
    const b: any = await req.json();
    if (typeof b.image !== "string" || b.image.length > 5e6)
      throw new ApiError(400, "Provide a base64-encoded image under 3 MB.");
    const m = await resolveModel(
      key.project_id,
      key.owner,
      undefined,
      b.packId,
    );
    const result = (await (
      await worker(`/models/${m.jobId}/predict`, { image: b.image })
    ).json()) as any;
    await run(
      "INSERT INTO usage VALUES(?,?,?,?,?,?)",
      id(),
      key.project_id,
      m.jobId,
      m.packId,
      now(),
      result.predictions.length,
    );
    return Response.json(result);
  } catch (e) {
    return responseError(e);
  }
}
