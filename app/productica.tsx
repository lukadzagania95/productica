"use client";
import { useEffect, useRef, useState } from "react";
import {
  Plus,
  ScanLine,
  Library,
  FolderOpen,
  ArrowUpRight,
  ImagePlus,
  Upload,
  Check,
  Play,
  Download,
  Trash2,
  Lock,
  Loader2,
  ChevronLeft,
  Sparkles,
  KeyRound,
  RefreshCw,
  Package,
  Layers,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Toaster, toast } from "sonner";
type Box = { skuId: string; x: number; y: number; w: number; h: number };
type Item = { id: string; name: string; [key: string]: any };
const initial = {
  user: null,
  workspaces: [],
  projects: [],
  images: [],
  skus: [],
  jobs: [],
  packs: [],
  licenses: [],
  usage: 0,
  workerConfigured: false,
};
const colors = [
  "#AFD253",
  "#59A6BD",
  "#E29B51",
  "#BC86CE",
  "#DE7676",
  "#4CAA97",
];
async function api(body: any): Promise<any> {
  let r = await fetch("/api/studio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let o: any = await r.json();
  if (!r.ok) throw Error(o.error || "Request failed");
  return o;
}
function Choices({
  value,
  onChange,
  items,
  placeholder = "Select",
  label,
}: {
  value: string;
  onChange: (s: string) => void;
  items: { value: string; label: string }[];
  placeholder?: string;
  label?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label || placeholder} className="choice">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value}>
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function pct(v: number | undefined) {
  return v == null ? "—" : `${(v * 100).toFixed(1)}%`;
}
function metrics(j: any) {
  try {
    return typeof j.metrics === "string" ? JSON.parse(j.metrics) : j.metrics;
  } catch {
    return null;
  }
}
function imageUrl(id: string) {
  return `/api/studio?kind=image&id=${encodeURIComponent(id)}`;
}
async function prepare(file: File) {
  const img = await createImageBitmap(file);
  let scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  let canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  img.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(Error("Image could not be read."))),
      "image/jpeg",
      0.9,
    ),
  );
  return { blob, width: canvas.width, height: canvas.height };
}
async function uploadFile(file: File, projectId: string): Promise<any> {
  const im = await prepare(file),
    form = new FormData();
  form.append("projectId", projectId);
  form.append("file", im.blob, file.name);
  form.append("width", String(im.width));
  form.append("height", String(im.height));
  const r = await fetch("/api/studio", { method: "POST", body: form }),
    o = (await r.json()) as any;
  if (!r.ok) throw Error(o.error);
  return o;
}
export default function Productica() {
  const [data, setData] = useState<any>(initial),
    [pid, setPid] = useState(""),
    [screen, setScreen] = useState("projects"),
    [tab, setTab] = useState("images"),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [dialog, setDialog] = useState(""),
    [name, setName] = useState(""),
    [wid, setWid] = useState(""),
    [editing, setEditing] = useState<Item | null>(null),
    [query, setQuery] = useState(""),
    [testFile, setTestFile] = useState<File | null>(null),
    [testUrl, setTestUrl] = useState(""),
    [predictions, setPredictions] = useState<any[] | null>(null),
    [modelChoice, setModelChoice] = useState(""),
    [apiKey, setApiKey] = useState(""),
    [publishJob, setPublishJob] = useState(""),
    [visibility, setVisibility] = useState("private"),
    [terms, setTerms] = useState(
      "Use this recognition pack in your own projects. Redistribution is not permitted.",
    ),
    [consent, setConsent] = useState(false),
    [licensePack, setLicensePack] = useState<Item | null>(null),
    [accepted, setAccepted] = useState(false);
  const upload = useRef<HTMLInputElement>(null),
    testInput = useRef<HTMLInputElement>(null);
  const firstLoad = useRef(true),
    requestSequence = useRef(0),
    currentPid = useRef(pid),
    webState = useRef({ data, pid });
  currentPid.current = pid;
  webState.current = { data, pid };
  const project = data.projects.find((p: Item) => p.id === pid);
  const completed = data.jobs.filter((j: Item) => j.status === "complete");
  const running = data.jobs.filter((j: Item) =>
    ["running", "queued"].includes(j.status),
  );
  const activePacks = data.licenses.filter(
    (l: Item) => l.project_id === pid && l.status === "approved",
  );
  async function load(selected = pid) {
    const sequence = ++requestSequence.current;
    const r = await fetch(
      "/api/studio" + (selected ? `?project=${selected}` : ""),
    );
    const d: any = await r.json();
    if (sequence !== requestSequence.current || selected !== currentPid.current)
      return;
    if (!r.ok) {
      setError(d.error);
      if (r.status === 401) setData(initial);
      setLoading(false);
      return;
    }
    setData(d);
    setError("");
    setLoading(false);
    if (firstLoad.current) {
      firstLoad.current = false;
      const p = d.projects[0];
      if (p) {
        setPid(p.id);
        setWid(p.workspace_id);
      } else if (d.workspaces.length) setWid(d.workspaces[0].id);
    } else if (selected) {
      const p = d.projects.find((p: Item) => p.id === selected);
      if (p) setWid(p.workspace_id);
    }
  }
  useEffect(() => {
    setLoading(true);
    setApiKey("");
    setModelChoice("");
    setTestFile(null);
    setTestUrl("");
    setPredictions(null);
    setEditing(null);
    load(pid).catch((e) => {
      setError(e.message);
      setLoading(false);
    });
  }, [pid]);
  useEffect(() => {
    const context = (document as any).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const definitions = [
      {
        name: "list_productica_projects",
        title: "List recognition projects",
        description:
          "Read projects in the signed-in account and the selected project. Does not read images or keys.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute(input: unknown) {
          if (!input || typeof input !== "object" || Object.keys(input).length)
            throw Error("Expected an empty object.");
          const s = webState.current;
          return {
            selectedProjectId: s.pid,
            projects: s.data.projects.map((p: Item) => ({
              id: p.id,
              name: p.name,
              workspaceId: p.workspace_id,
            })),
          };
        },
      },
      {
        name: "open_productica_project",
        title: "Open recognition project",
        description:
          "Navigate to an existing project and its image collection. Does not create, upload, or train anything.",
        inputSchema: {
          type: "object",
          properties: { projectId: { type: "string" } },
          required: ["projectId"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        async execute(input: unknown) {
          const v = input as any;
          if (
            !v ||
            typeof v.projectId !== "string" ||
            Object.keys(v).some((k) => k !== "projectId")
          )
            throw Error("Provide only projectId.");
          const p = webState.current.data.projects.find(
            (p: Item) => p.id === v.projectId,
          );
          if (!p) throw Error("Project not found.");
          setPid(p.id);
          setWid(p.workspace_id);
          setScreen("projects");
          setTab("images");
          await new Promise<void>((r) => requestAnimationFrame(() => r()));
          return { projectId: p.id, name: p.name, screen: "images" };
        },
      },
    ];
    for (const tool of definitions) {
      try {
        Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {}
    }
    return () => lifecycle.abort();
  }, []);
  useEffect(() => {
    if (!running.length) return;
    let done = false;
    const timer = setInterval(async () => {
      try {
        for (let j of running) {
          let r = await fetch(`/api/studio?kind=job&id=${j.id}`),
            o = (await r.json()) as any;
          if (!r.ok) throw Error(o.error);
        }
        if (!done) await load(pid);
      } catch (e) {
        if (!done) setError((e as Error).message);
      }
    }, 5000);
    return () => {
      done = true;
      clearInterval(timer);
    };
  }, [pid, running.map((j: Item) => j.id).join(",")]);
  useEffect(
    () => () => {
      if (testUrl) URL.revokeObjectURL(testUrl);
    },
    [testUrl],
  );
  async function act(label: string, body: any, after?: (r: any) => void) {
    setBusy(label);
    try {
      const r = await api({ projectId: pid, ...body });
      await load(pid);
      after?.(r);
      return r;
    } catch (e) {
      toast.error((e as Error).message);
      return null;
    } finally {
      setBusy("");
    }
  }
  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    setBusy("Creating project");
    try {
      let workspace = wid;
      if (!workspace) {
        let r = await api({ action: "workspace", name: "My workspace" });
        workspace = r.id;
        setWid(workspace);
      }
      let r = await api({ action: "project", workspaceId: workspace, name });
      setPid(r.id);
      setScreen("projects");
      setTab("images");
      setDialog("");
      setName("");
      await load(r.id);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function uploadMany(files: FileList | null) {
    if (!files || !pid) return;
    try {
      for (let i = 0; i < files.length; i++) {
        setBusy(`Uploading ${i + 1} of ${files.length}`);
        await uploadFile(files[i], pid);
      }
      await load(pid);
      toast.success("Images saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
      if (upload.current) upload.current.value = "";
    }
  }
  async function test() {
    if (!testFile || !modelChoice) return;
    setBusy("Recognizing products");
    try {
      const { blob } = await prepare(testFile),
        buffer = await blob.arrayBuffer();
      let str = "";
      for (const v of new Uint8Array(buffer)) str += String.fromCharCode(v);
      const r = await api({
        action: "predict",
        projectId: pid,
        image: btoa(str),
        ...(modelChoice.startsWith("pack:")
          ? { packId: modelChoice.slice(5) }
          : { jobId: modelChoice }),
      });
      setPredictions(r.predictions);
      await load(pid);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function sendToReview() {
    if (!testFile) return;
    setBusy("Saving for review");
    try {
      const r = await uploadFile(testFile, pid),
        boxes: Box[] = [];
      let classes = [...data.skus];
      for (let a of predictions || []) {
        let c = classes.find((c) => c.name === a.name);
        if (!c) {
          const n = await api({ action: "sku", projectId: pid, name: a.name });
          c = { id: n.id, name: a.name };
          classes.push(c);
        }
        boxes.push({
          skuId: c.id,
          x: a.x,
          y: a.y,
          w: Math.min(a.w, 1 - a.x),
          h: Math.min(a.h, 1 - a.y),
        });
      }
      await api({
        action: "annotations",
        projectId: pid,
        imageId: r.id,
        boxes,
        split: "train",
        reviewed: false,
      });
      await load(pid);
      setTab("images");
      toast.success("Saved as an unreviewed image");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const modelItems = [
    ...completed.map((j: Item) => ({
      value: j.id,
      label: `Model ${j.id.slice(0, 8)}${project?.production_job === j.id ? " · Production" : ""}`,
    })),
    ...activePacks.map((l: Item) => ({
      value: "pack:" + l.pack_id,
      label: l.pack_name + " · Licensed pack",
    })),
  ];
  return (
    <div className="app-shell">
      <Toaster position="bottom-right" richColors />
      <header className="topbar">
        <a className="brand" href="/">
          <img src="/mark.png" alt="" />
          Productica
        </a>
        <span className="muted">Recognition studio</span>
        <nav className="topnav">
          <button
            className={screen === "projects" ? "active" : ""}
            onClick={() => setScreen("projects")}
          >
            <FolderOpen size={17} />
            Projects
          </button>
          <button
            className={screen === "library" ? "active" : ""}
            onClick={() => setScreen("library")}
          >
            <Library size={17} />
            Recognition Library
          </button>
        </nav>
        <div className="avatar" title={data.user?.email || "Account"}>
          {data.user?.email?.[0]?.toUpperCase() || "P"}
        </div>
      </header>
      <main className="main">
        {error && (
          <div className="notice error" role="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
            {!data.user ? (
              <a href="/signin-with-chatgpt?return_to=/" target="_top">
                Sign in with ChatGPT
              </a>
            ) : (
              <Button variant="outline" onClick={() => load(pid)}>
                Retry
              </Button>
            )}
          </div>
        )}
        {busy && (
          <div className="busy" role="status">
            <Loader2 className="spin" size={16} />
            {busy}
          </div>
        )}
        {loading ? (
          <div className="empty">
            <Loader2 className="spin" />
            <h2>Opening your workspace</h2>
          </div>
        ) : (
          data.user && (
            <>
              <div className="workspace-line">
                <Choices
                  label="Workspace"
                  value={wid}
                  onChange={(w) => {
                    setWid(w);
                    let p = data.projects.find(
                      (p: Item) => p.workspace_id === w,
                    );
                    setPid(p?.id || "");
                  }}
                  items={data.workspaces.map((w: Item) => ({
                    value: w.id,
                    label: w.name,
                  }))}
                  placeholder="My workspace"
                />
                <button
                  onClick={() => {
                    setName("");
                    setDialog("workspace");
                  }}
                  className="text-button"
                >
                  <Plus size={15} />
                  Workspace
                </button>
                <span className="private-note">
                  <Lock size={13} />
                  Private by default
                </span>
              </div>
              {screen === "projects" ? (
                <>
                  <div className="heading-row">
                    <div>
                      <div className="eyebrow">YOUR RECOGNITION WORKSPACE</div>
                      <h1>
                        {project ? project.name : "Teach vision your products."}
                      </h1>
                      <p>
                        {project
                          ? "Your catalogue, your labels, your recognition."
                          : "Build your catalogue. Train recognition. Put it to work."}
                      </p>
                    </div>
                    <Button
                      onClick={() => {
                        setName("");
                        setDialog("project");
                      }}
                    >
                      <Plus size={18} />
                      New project
                    </Button>
                  </div>
                  {data.projects.length > 0 && (
                    <div className="project-switch">
                      <Choices
                        label="Project"
                        value={pid}
                        onChange={setPid}
                        items={data.projects
                          .filter((p: Item) => p.workspace_id === wid)
                          .map((p: Item) => ({ value: p.id, label: p.name }))}
                        placeholder="Choose a project"
                      />
                    </div>
                  )}
                  {!project ? (
                    <section className="workspace-start">
                      <div>
                        <ScanLine size={40} />
                        <h2>Your first recognition project</h2>
                        <p>
                          Bring product or shelf photos. Define the SKUs you
                          want to recognize, then review labels before training.
                        </p>
                        <Button
                          onClick={() => {
                            setName("");
                            setDialog("project");
                          }}
                        >
                          Create a project
                          <ArrowUpRight size={17} />
                        </Button>
                      </div>
                      <div className="start-steps">
                        <div>
                          <ImagePlus />
                          Upload product photos
                        </div>
                        <div>
                          <ScanLine />
                          Review suggested labels
                        </div>
                        <div>
                          <Layers />
                          Train and test a model
                        </div>
                        <div>
                          <Library />
                          Reuse recognition packs
                        </div>
                      </div>
                    </section>
                  ) : (
                    <>
                      <div className="stats">
                        <div>
                          <span>Images</span>
                          <strong>{data.images.length}</strong>
                        </div>
                        <div>
                          <span>Reviewed</span>
                          <strong>
                            {data.images.filter((i: Item) => i.reviewed).length}
                            <small> / {data.images.length}</small>
                          </strong>
                        </div>
                        <div>
                          <span>SKUs</span>
                          <strong>{data.skus.length}</strong>
                        </div>
                        <div>
                          <span>Model versions</span>
                          <strong>{completed.length}</strong>
                        </div>
                        <div>
                          <span>Predictions run</span>
                          <strong>{data.usage}</strong>
                        </div>
                      </div>
                      <Tabs
                        value={tab}
                        onValueChange={setTab}
                        className="studio-tabs"
                      >
                        <TabsList variant="line">
                          <TabsTrigger value="images">
                            01 Images & labels
                          </TabsTrigger>
                          <TabsTrigger value="models">
                            02 Train & evaluate
                          </TabsTrigger>
                          <TabsTrigger value="test">
                            03 Test & improve
                          </TabsTrigger>
                          <TabsTrigger value="deploy">
                            04 Deploy & share
                          </TabsTrigger>
                        </TabsList>
                        <TabsContent value="images">
                          <div className="dataset-layout">
                            <section className="surface">
                              <div className="section-head">
                                <div>
                                  <h2>Image collection</h2>
                                  <p>
                                    Review every box. Keep separate images for
                                    validation.
                                  </p>
                                </div>
                                <Button
                                  onClick={() => upload.current?.click()}
                                  disabled={!!busy}
                                >
                                  <Upload size={16} />
                                  Upload images
                                </Button>
                                <input
                                  ref={upload}
                                  type="file"
                                  accept="image/jpeg,image/png"
                                  multiple
                                  hidden
                                  onChange={(e) => uploadMany(e.target.files)}
                                />
                              </div>
                              {!data.images.length ? (
                                <button
                                  className="upload-zone"
                                  onClick={() => upload.current?.click()}
                                  onDragOver={(e) => e.preventDefault()}
                                  onDrop={(e) => {
                                    e.preventDefault();
                                    uploadMany(e.dataTransfer.files);
                                  }}
                                >
                                  <ImagePlus size={40} />
                                  <strong>Drop your product photos here</strong>
                                  <span>
                                    JPEG or PNG · Images are resized for upload
                                  </span>
                                </button>
                              ) : (
                                <div className="image-grid">
                                  {data.images.map((im: Item) => (
                                    <button
                                      className="image-tile"
                                      key={im.id}
                                      onClick={() => setEditing(im)}
                                    >
                                      <div>
                                        <img
                                          src={imageUrl(im.id)}
                                          alt={im.name}
                                        />
                                        <span
                                          className={
                                            "image-status " +
                                            (im.reviewed ? "reviewed" : "")
                                          }
                                        >
                                          {im.reviewed ? (
                                            <Check size={12} />
                                          ) : null}
                                          {im.reviewed
                                            ? "Reviewed"
                                            : "To review"}
                                        </span>
                                      </div>
                                      <strong>{im.name}</strong>
                                      <span>
                                        {JSON.parse(im.annotations).length}{" "}
                                        boxes ·{" "}
                                        {im.split === "validation"
                                          ? "Validation"
                                          : "Training"}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </section>
                            <aside className="surface sku-panel">
                              <h2>SKU catalogue</h2>
                              <p>The products this project recognizes.</p>
                              <form
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  const f = new FormData(e.currentTarget),
                                    form = e.currentTarget;
                                  act(
                                    "Adding SKU",
                                    {
                                      action: "sku",
                                      name: f.get("sku"),
                                      color:
                                        colors[
                                          data.skus.length % colors.length
                                        ],
                                    },
                                    () => form.reset(),
                                  );
                                }}
                              >
                                <label className="sr-only" htmlFor="newsku">
                                  SKU name
                                </label>
                                <input
                                  id="newsku"
                                  name="sku"
                                  placeholder="e.g. Cola Original 330 ml"
                                  required
                                  maxLength={120}
                                />
                                <Button
                                  type="submit"
                                  disabled={!!busy}
                                  variant="outline"
                                >
                                  <Plus size={16} />
                                  Add SKU
                                </Button>
                              </form>
                              <div className="sku-list">
                                {data.skus.map((c: Item) => (
                                  <div key={c.id}>
                                    <span style={{ background: c.color }} />
                                    {c.name}
                                    <small>
                                      {data.images.reduce(
                                        (n: number, i: Item) =>
                                          n +
                                          JSON.parse(i.annotations).filter(
                                            (a: Box) => a.skuId === c.id,
                                          ).length,
                                        0,
                                      )}
                                    </small>
                                  </div>
                                ))}
                              </div>
                              {!data.skus.length && (
                                <div className="hint">
                                  Add a SKU before labeling your photos.
                                </div>
                              )}
                              <a
                                className="text-button"
                                href={`/api/studio?kind=dataset&project=${pid}`}
                              >
                                <Download size={15} />
                                Export annotations
                              </a>
                            </aside>
                          </div>
                        </TabsContent>
                        <TabsContent value="models">
                          <div className="training-intro surface">
                            <div>
                              <span className="eyebrow">
                                RECOMMENDED FOR YOUR PROJECT
                              </span>
                              <h2>Product detection</h2>
                              <p>
                                Fine-tune a pretrained detector on your reviewed
                                images. Your validation set measures how well it
                                recognizes photos it has not trained on.
                              </p>
                              <div className="small muted">
                                {
                                  data.images.filter(
                                    (i: Item) =>
                                      i.reviewed && i.split === "train",
                                  ).length
                                }{" "}
                                training images ·{" "}
                                {
                                  data.images.filter(
                                    (i: Item) =>
                                      i.reviewed && i.split === "validation",
                                  ).length
                                }{" "}
                                validation images
                              </div>
                            </div>
                            <Button
                              disabled={
                                !!busy ||
                                !!running.length ||
                                !data.workerConfigured
                              }
                              onClick={() =>
                                act(
                                  "Starting training",
                                  { action: "train" },
                                  () => toast.success("Training job started"),
                                )
                              }
                            >
                              <Play size={17} />
                              Train a model
                            </Button>
                          </div>
                          {!data.workerConfigured && (
                            <div className="notice">
                              <AlertCircle size={18} />
                              <span>
                                Training service is not connected yet. You can
                                prepare images and labels now.
                              </span>
                            </div>
                          )}
                          {!data.jobs.length ? (
                            <div className="empty">
                              <Layers />
                              <h2>No model versions yet</h2>
                              <p>
                                Review at least two training images and one
                                validation image, with every SKU represented in
                                both sets.
                              </p>
                            </div>
                          ) : (
                            data.jobs.map((j: Item, index: number) => {
                              let m = metrics(j);
                              return (
                                <section
                                  className="surface model-card"
                                  key={j.id}
                                >
                                  <div className="section-head">
                                    <div>
                                      <span className="eyebrow">
                                        VERSION {data.jobs.length - index}
                                      </span>
                                      <h2>
                                        {j.status === "complete"
                                          ? "Model ready for testing"
                                          : j.status === "failed"
                                            ? "Training needs attention"
                                            : j.status === "cancelled"
                                              ? "Training cancelled"
                                              : "Training in progress"}
                                      </h2>
                                      <p>
                                        {new Date(j.created).toLocaleString()} ·{" "}
                                        {j.id.slice(0, 8)}
                                        {project.production_job === j.id
                                          ? " · Production"
                                          : ""}
                                      </p>
                                    </div>
                                    <span className={"status " + j.status}>
                                      {j.status}
                                    </span>
                                  </div>
                                  {["running", "queued"].includes(j.status) && (
                                    <>
                                      <Progress value={j.progress} />
                                      <p>
                                        {j.message ||
                                          "Waiting for the training service"}
                                      </p>
                                      <Button
                                        variant="outline"
                                        onClick={() =>
                                          act("Cancelling job", {
                                            action: "cancel",
                                            jobId: j.id,
                                          })
                                        }
                                      >
                                        Cancel training
                                      </Button>
                                    </>
                                  )}
                                  {j.status === "failed" && (
                                    <p className="error-text">{j.message}</p>
                                  )}
                                  {m && (
                                    <>
                                      <div className="metric-row">
                                        <div>
                                          <span>mAP</span>
                                          <strong>{pct(m.map)}</strong>
                                        </div>
                                        <div>
                                          <span>Precision</span>
                                          <strong>{pct(m.precision)}</strong>
                                        </div>
                                        <div>
                                          <span>Recall</span>
                                          <strong>{pct(m.recall)}</strong>
                                        </div>
                                        <div>
                                          <span>Validation images</span>
                                          <strong>{m.validationImages}</strong>
                                        </div>
                                      </div>
                                      <details>
                                        <summary>
                                          Per-SKU results and confusion matrix
                                        </summary>
                                        <div className="table-scroll">
                                          <table>
                                            <thead>
                                              <tr>
                                                <th>SKU</th>
                                                <th>Precision</th>
                                                <th>Recall</th>
                                                <th>AP</th>
                                                <th>Examples</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {m.perClass.map((c: any) => (
                                                <tr key={c.id}>
                                                  <td>{c.name}</td>
                                                  <td>{pct(c.precision)}</td>
                                                  <td>{pct(c.recall)}</td>
                                                  <td>{pct(c.ap)}</td>
                                                  <td>{c.support}</td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                          <p className="small">
                                            Rows: actual. Columns: predicted.
                                            Background includes misses and false
                                            detections.
                                          </p>
                                          <table>
                                            <thead>
                                              <tr>
                                                <th>Actual / Predicted</th>
                                                {m.confusionLabels.map(
                                                  (l: string) => (
                                                    <th key={l}>{l}</th>
                                                  ),
                                                )}
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {m.confusion.map(
                                                (row: number[], i: number) => (
                                                  <tr key={i}>
                                                    <th>
                                                      {m.confusionLabels[i]}
                                                    </th>
                                                    {row.map(
                                                      (
                                                        n: number,
                                                        k: number,
                                                      ) => (
                                                        <td key={k}>{n}</td>
                                                      ),
                                                    )}
                                                  </tr>
                                                ),
                                              )}
                                            </tbody>
                                          </table>
                                        </div>
                                        <p className="small">{m.definition}</p>
                                      </details>
                                      <div className="button-row">
                                        <Button
                                          onClick={() => {
                                            setModelChoice(j.id);
                                            setTab("test");
                                          }}
                                        >
                                          Test this model
                                          <ArrowUpRight size={15} />
                                        </Button>
                                        <Button
                                          variant="outline"
                                          disabled={
                                            project.production_job === j.id ||
                                            !!busy
                                          }
                                          onClick={() =>
                                            act(
                                              "Promoting model",
                                              {
                                                action: "promote",
                                                jobId: j.id,
                                              },
                                              () =>
                                                toast.success(
                                                  "Production model updated",
                                                ),
                                            )
                                          }
                                        >
                                          {project.production_job === j.id ? (
                                            <CheckCircle2 size={16} />
                                          ) : null}
                                          {project.production_job === j.id
                                            ? "In production"
                                            : "Promote to production"}
                                        </Button>
                                      </div>
                                    </>
                                  )}
                                </section>
                              );
                            })
                          )}
                        </TabsContent>
                        <TabsContent value="test">
                          <section className="surface">
                            <div className="section-head">
                              <div>
                                <h2>Try a new shelf photo</h2>
                                <p>
                                  Test recognition, inspect the boxes, then send
                                  difficult examples back for review.
                                </p>
                              </div>
                              <Choices
                                label="Recognition model"
                                value={modelChoice}
                                onChange={(s) => {
                                  setModelChoice(s);
                                  setPredictions(null);
                                }}
                                items={modelItems}
                                placeholder="Choose model or pack"
                              />
                            </div>
                            <div className="test-layout">
                              <div>
                                {testUrl ? (
                                  <div className="prediction-image">
                                    <img src={testUrl} alt="Test image" />
                                    {predictions && (
                                      <svg
                                        viewBox="0 0 1000 1000"
                                        preserveAspectRatio="none"
                                      >
                                        {predictions.map(
                                          (a: any, i: number) => (
                                            <g key={i}>
                                              <rect
                                                x={a.x * 1000}
                                                y={a.y * 1000}
                                                width={a.w * 1000}
                                                height={a.h * 1000}
                                              />
                                            </g>
                                          ),
                                        )}
                                      </svg>
                                    )}
                                  </div>
                                ) : (
                                  <button
                                    className="upload-zone"
                                    onClick={() => testInput.current?.click()}
                                  >
                                    <ScanLine size={42} />
                                    <strong>Choose an unseen photo</strong>
                                    <span>
                                      Test with a photo outside your training
                                      set
                                    </span>
                                  </button>
                                )}
                                <input
                                  ref={testInput}
                                  type="file"
                                  accept="image/jpeg,image/png"
                                  hidden
                                  onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f) {
                                      setTestFile(f);
                                      setTestUrl(URL.createObjectURL(f));
                                      setPredictions(null);
                                    }
                                  }}
                                />
                                <div className="button-row">
                                  <Button
                                    disabled={
                                      !!busy || !modelChoice || !testFile
                                    }
                                    onClick={test}
                                  >
                                    <ScanLine size={16} />
                                    Run recognition
                                  </Button>
                                  <Button
                                    variant="outline"
                                    onClick={() => testInput.current?.click()}
                                  >
                                    Change photo
                                  </Button>
                                </div>
                              </div>
                              <div>
                                <h3>Recognized products</h3>
                                {predictions === null ? (
                                  <p>
                                    Predictions will appear here after a test.
                                  </p>
                                ) : !predictions.length ? (
                                  <div className="notice">
                                    No confident detections. Review this example
                                    and add more varied training photos.
                                  </div>
                                ) : (
                                  <>
                                    {Array.from(
                                      new Set(predictions.map((p) => p.name)),
                                    ).map((n: any) => (
                                      <div className="prediction-row" key={n}>
                                        <Package size={18} />
                                        <span>{n}</span>
                                        <strong>
                                          {
                                            predictions.filter(
                                              (p) => p.name === n,
                                            ).length
                                          }
                                        </strong>
                                      </div>
                                    ))}
                                    <p className="small">
                                      {predictions.length} visible products
                                      above confidence 0.30. Counts are
                                      detections, not an out-of-stock
                                      assessment.
                                    </p>
                                  </>
                                )}
                                {predictions !== null && (
                                  <Button
                                    variant="outline"
                                    disabled={!!busy}
                                    onClick={sendToReview}
                                  >
                                    <RefreshCw size={15} />
                                    Send photo to review
                                  </Button>
                                )}
                              </div>
                            </div>
                          </section>
                        </TabsContent>
                        <TabsContent value="deploy">
                          <div className="deploy-grid">
                            <section className="surface">
                              <Lock size={27} />
                              <h2>Inference API</h2>
                              <p>
                                Use your production model from another
                                application. API keys belong to this project.
                              </p>
                              <Button
                                disabled={!!busy}
                                onClick={() =>
                                  act(
                                    "Creating API key",
                                    { action: "apiKey" },
                                    (r) => setApiKey(r.key),
                                  )
                                }
                              >
                                <KeyRound size={16} />
                                {apiKey ? "Rotate API key" : "Create API key"}
                              </Button>
                              {apiKey && (
                                <div className="key-output">
                                  <p>
                                    Copy this key now. Generating a new key
                                    revokes the old one.
                                  </p>
                                  <code>{apiKey}</code>
                                  <Button
                                    variant="outline"
                                    onClick={() =>
                                      navigator.clipboard
                                        .writeText(apiKey)
                                        .then(() => toast.success("Copied"))
                                    }
                                  >
                                    Copy key
                                  </Button>
                                </div>
                              )}
                              <div className="code-note">
                                <code>POST /api/infer</code>
                                <br />
                                <code>Authorization: Bearer YOUR_KEY</code>
                                <pre>{'{"image":"BASE64_IMAGE"}'}</pre>
                              </div>
                              <p className="small">
                                Promote a model first. To use a licensed pack,
                                also send its packId. Private hosted previews
                                also require site sign-in; standalone clients
                                can use the local endpoint.
                              </p>
                            </section>
                            <section className="surface">
                              <Library size={27} />
                              <h2>Publish a Recognition Pack</h2>
                              <p>
                                Share the trained capability. Your training
                                photos remain private.
                              </p>
                              <Button
                                disabled={!completed.length}
                                onClick={() => {
                                  setPublishJob(completed[0]?.id || "");
                                  setName(project.name + " Recognition Pack");
                                  setConsent(false);
                                  setDialog("publish");
                                }}
                              >
                                <Plus size={16} />
                                Create a pack
                              </Button>
                              <h3 className="mt-8">Export your model</h3>
                              <p className="small">
                                Download the checkpoint, SKU mapping and
                                evaluation results.
                              </p>
                              {completed.map((j: Item) => (
                                <a
                                  className="export-link"
                                  key={j.id}
                                  href={`/api/studio?kind=export&id=${j.id}`}
                                >
                                  <Download size={17} />
                                  Model {j.id.slice(0, 8)}
                                  <ArrowUpRight size={15} />
                                </a>
                              ))}
                            </section>
                          </div>
                        </TabsContent>
                      </Tabs>
                    </>
                  )}
                </>
              ) : (
                <>
                  <div className="heading-row">
                    <div>
                      <div className="eyebrow">
                        REUSABLE PRODUCT RECOGNITION
                      </div>
                      <h1>Recognition Library</h1>
                      <p>
                        Activate existing recognition. Keep your own training
                        images private.
                      </p>
                    </div>
                    <div className="search">
                      <input
                        aria-label="Search recognition packs"
                        placeholder="Search packs or SKUs"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </div>
                  </div>
                  {!pid ? (
                    <div className="notice">
                      Create a project to activate a recognition pack.
                    </div>
                  ) : (
                    <div className="library-project">
                      <span>Activate in</span>
                      <Choices
                        label="Target project"
                        value={pid}
                        onChange={setPid}
                        items={data.projects.map((p: Item) => ({
                          value: p.id,
                          label: p.name,
                        }))}
                      />
                    </div>
                  )}
                  {data.licenses.some(
                    (l: Item) =>
                      l.contributor === data.user.id &&
                      l.status === "requested",
                  ) && (
                    <section className="surface">
                      <h2>License requests</h2>
                      {data.licenses
                        .filter(
                          (l: Item) =>
                            l.contributor === data.user.id &&
                            l.status === "requested",
                        )
                        .map((l: Item) => (
                          <div className="section-head" key={l.id}>
                            <span>
                              {l.pack_name} · Requested{" "}
                              {new Date(l.created).toLocaleDateString()}
                            </span>
                            <Button
                              onClick={() =>
                                act("Approving license", {
                                  action: "approveLicense",
                                  id: l.id,
                                })
                              }
                            >
                              Approve license
                            </Button>
                          </div>
                        ))}
                      <p className="small">
                        Agree commercial terms and payment separately before
                        approving. Productica records access and usage.
                      </p>
                    </section>
                  )}
                  <div className="pack-grid">
                    {data.packs
                      .filter((k: Item) =>
                        (k.name + " " + k.classes)
                          .toLowerCase()
                          .includes(query.toLowerCase()),
                      )
                      .map((k: Item) => {
                        const license = data.licenses.find(
                          (l: Item) =>
                            l.pack_id === k.id && l.project_id === pid,
                        );
                        let m = metrics(k);
                        return (
                          <article className="surface pack" key={k.id}>
                            <div className="pack-icon">
                              <Package size={30} />
                            </div>
                            <span className={"visibility " + k.visibility}>
                              {k.visibility}
                            </span>
                            <h2>{k.name}</h2>
                            <p>
                              {k.description ||
                                "Versioned recognition for a product catalogue."}
                            </p>
                            <div className="pack-stats">
                              <strong>
                                {JSON.parse(k.classes).length} SKUs
                              </strong>
                              <span>mAP {pct(m?.map)}</span>
                            </div>
                            <p className="small">
                              {JSON.parse(k.classes)
                                .map((c: Item) => c.name)
                                .join(", ")}
                            </p>
                            <Button
                              variant={license ? "outline" : "default"}
                              disabled={!pid || !!busy || !!license}
                              onClick={() => {
                                setLicensePack(k);
                                setAccepted(false);
                              }}
                            >
                              {license
                                ? license.status === "approved"
                                  ? "Activated"
                                  : "License requested"
                                : k.visibility === "marketplace" &&
                                    k.owner !== data.user.id
                                  ? "Request license"
                                  : "Activate pack"}
                              <ArrowUpRight size={16} />
                            </Button>
                          </article>
                        );
                      })}
                  </div>
                  {!data.packs.length && (
                    <div className="empty">
                      <Library size={42} />
                      <h2>Your library starts with a trained model</h2>
                      <p>
                        Train and evaluate a catalogue, then publish a
                        Recognition Pack from Deploy & share.
                      </p>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setScreen("projects");
                          setTab("deploy");
                        }}
                      >
                        Go to your project
                      </Button>
                    </div>
                  )}
                </>
              )}
            </>
          )
        )}
        <footer>
          Productica <span>Customer-owned recognition.</span>
          {data.user && (
            <a href="/signout-with-chatgpt?return_to=/" target="_top">
              Sign out
            </a>
          )}
        </footer>
      </main>
      <Dialog
        open={dialog === "project" || dialog === "workspace"}
        onOpenChange={(o) => !o && setDialog("")}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog === "workspace"
                ? "Create a workspace"
                : "Create a recognition project"}
            </DialogTitle>
            <DialogDescription>
              {dialog === "workspace"
                ? "Organize your projects in a separate workspace."
                : "Start with a focused set of products and photos."}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={
              dialog === "workspace"
                ? (e) => {
                    e.preventDefault();
                    act(
                      "Creating workspace",
                      { action: "workspace", name },
                      (r) => {
                        setWid(r.id);
                        setPid("");
                        setDialog("");
                      },
                    );
                  }
                : createProject
            }
          >
            <label>
              Name
              <input
                autoFocus
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  dialog === "workspace" ? "My company" : "Beverage catalogue"
                }
              />
            </label>
            {dialog === "project" && data.workspaces.length > 0 && (
              <label>
                Workspace
                <Choices
                  value={wid}
                  onChange={setWid}
                  items={data.workspaces.map((w: Item) => ({
                    value: w.id,
                    label: w.name,
                  }))}
                />
              </label>
            )}
            <Button type="submit" disabled={!!busy || !name.trim()}>
              Create {dialog === "workspace" ? "workspace" : "project"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={dialog === "publish"}
        onOpenChange={(o) => !o && setDialog("")}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a Recognition Pack</DialogTitle>
            <DialogDescription>
              Only model capability is shared. Training photos remain private.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              act(
                "Publishing pack",
                {
                  action: "publish",
                  name,
                  jobId: publishJob,
                  visibility,
                  terms,
                  consent,
                },
                () => {
                  setDialog("");
                  toast.success("Pack published");
                  setScreen("library");
                },
              );
            }}
          >
            <label>
              Pack name
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Model
              <Choices
                value={publishJob}
                onChange={setPublishJob}
                items={completed.map((j: Item) => ({
                  value: j.id,
                  label: j.id.slice(0, 8),
                }))}
              />
            </label>
            <label>
              Visibility
              <Choices
                value={visibility}
                onChange={setVisibility}
                items={[
                  { value: "private", label: "Private · only you" },
                  {
                    value: "shared",
                    label: "Shared · activate with accepted terms",
                  },
                  {
                    value: "marketplace",
                    label: "Marketplace · contributor approval",
                  },
                ]}
              />
            </label>
            <label>
              License terms
              <textarea
                required
                maxLength={1000}
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
              />
            </label>
            <label className="check-label">
              <Checkbox
                checked={consent}
                onCheckedChange={(v) => setConsent(v === true)}
              />
              I have the rights to share this recognition and consent to this
              visibility.
            </label>
            <Button disabled={!consent || !!busy}>Publish pack</Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!licensePack}
        onOpenChange={(o) => !o && setLicensePack(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{licensePack?.name}</DialogTitle>
            <DialogDescription>
              Review the contributor’s license before activating.
            </DialogDescription>
          </DialogHeader>
          <p className="license-terms">{licensePack?.terms}</p>
          <label className="check-label">
            <Checkbox
              checked={accepted}
              onCheckedChange={(v) => setAccepted(v === true)}
            />
            I accept these terms for the selected project.
          </label>
          <Button
            disabled={!accepted || !!busy}
            onClick={() =>
              act(
                "Activating pack",
                {
                  action: "activate",
                  packId: licensePack?.id,
                  acceptTerms: accepted,
                },
                (r) => {
                  setLicensePack(null);
                  toast.success(
                    r.status === "approved"
                      ? "Pack activated"
                      : "License request sent",
                  );
                },
              )
            }
          >
            Confirm
          </Button>
        </DialogContent>
      </Dialog>
      {editing && (
        <AnnotationEditor
          image={editing}
          skus={data.skus}
          workerConfigured={data.workerConfigured}
          busy={busy}
          onClose={() => setEditing(null)}
          save={(boxes, split, reviewed) =>
            act(
              "Saving labels",
              {
                action: "annotations",
                imageId: editing.id,
                boxes,
                split,
                reviewed,
              },
              () => {
                setEditing(null);
                toast.success("Labels saved");
              },
            )
          }
          suggest={() =>
            api({ action: "suggest", projectId: pid, imageId: editing.id })
          }
          remove={() =>
            act(
              "Deleting image",
              { action: "deleteImage", imageId: editing.id },
              () => setEditing(null),
            )
          }
        />
      )}
    </div>
  );
}
function AnnotationEditor({
  image,
  skus,
  workerConfigured,
  busy,
  onClose,
  save,
  suggest,
  remove,
}: {
  image: Item;
  skus: Item[];
  workerConfigured: boolean;
  busy: string;
  onClose: () => void;
  save: (b: Box[], s: string, r: boolean) => void;
  suggest: () => Promise<any>;
  remove: () => void;
}) {
  const [boxes, setBoxes] = useState<Box[]>(JSON.parse(image.annotations)),
    [sku, setSku] = useState(skus[0]?.id || ""),
    [split, setSplit] = useState(image.split),
    [selected, setSelected] = useState(-1),
    [drawing, setDrawing] = useState<{ x: number; y: number } | null>(null),
    [draft, setDraft] = useState<Box | null>(null),
    [suggesting, setSuggesting] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  function point(e: React.PointerEvent) {
    const r = stage.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }
  function end(e: React.PointerEvent) {
    if (drawing) {
      let p = point(e),
        a = {
          skuId: sku,
          x: Math.min(p.x, drawing.x),
          y: Math.min(p.y, drawing.y),
          w: Math.abs(p.x - drawing.x),
          h: Math.abs(p.y - drawing.y),
        };
      if (a.w > 0.005 && a.h > 0.005) {
        setBoxes([...boxes, a]);
        setSelected(boxes.length);
      }
      setDrawing(null);
      setDraft(null);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="annotation-dialog">
        <DialogHeader>
          <DialogTitle>{image.name}</DialogTitle>
          <DialogDescription>
            Choose a SKU, then drag a box around each visible product. Click a
            box to select it.
          </DialogDescription>
        </DialogHeader>
        <div className="editor-layout">
          <div className="editor-canvas">
            <div
              ref={stage}
              className="annotation-stage"
              onPointerDown={(e) => {
                if (!sku) return;
                stage.current?.setPointerCapture(e.pointerId);
                setDrawing(point(e));
              }}
              onPointerMove={(e) => {
                if (drawing) {
                  const p = point(e);
                  setDraft({
                    skuId: sku,
                    x: Math.min(p.x, drawing.x),
                    y: Math.min(p.y, drawing.y),
                    w: Math.abs(p.x - drawing.x),
                    h: Math.abs(p.y - drawing.y),
                  });
                }
              }}
              onPointerUp={end}
              onPointerCancel={() => {
                setDrawing(null);
                setDraft(null);
              }}
            >
              <img
                draggable={false}
                src={imageUrl(image.id)}
                alt={image.name}
              />
              <svg viewBox="0 0 1000 1000" preserveAspectRatio="none">
                {[...boxes, ...(draft ? [draft] : [])].map((a, i) => {
                  let c = skus.find((c) => c.id === a.skuId);
                  return (
                    <g
                      key={i}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setSelected(i);
                        setSku(a.skuId);
                      }}
                    >
                      <rect
                        x={a.x * 1000}
                        y={a.y * 1000}
                        width={a.w * 1000}
                        height={a.h * 1000}
                        stroke={c?.color || "#afd253"}
                        strokeWidth={selected === i ? 5 : 3}
                        fill={selected === i ? "#afd25322" : "transparent"}
                      />
                      <text
                        x={a.x * 1000 + 5}
                        y={Math.max(22, a.y * 1000 + 22)}
                      >
                        {i + 1}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
          <aside className="editor-tools">
            <label>
              Selected SKU
              <Choices
                label="Selected SKU"
                value={sku}
                onChange={(v) => {
                  setSku(v);
                  if (selected >= 0)
                    setBoxes(
                      boxes.map((a, i) =>
                        i === selected ? { ...a, skuId: v } : a,
                      ),
                    );
                }}
                items={skus.map((s) => ({ value: s.id, label: s.name }))}
                placeholder="Add a SKU first"
              />
            </label>
            <div className="button-stack">
              <Button
                variant="outline"
                disabled={!sku}
                onClick={() => {
                  setBoxes([...boxes, { skuId: sku, x: 0, y: 0, w: 1, h: 1 }]);
                  setSelected(boxes.length);
                }}
              >
                Label entire image
              </Button>
              <Button
                variant="outline"
                disabled={!sku || !workerConfigured || suggesting}
                onClick={async () => {
                  setSuggesting(true);
                  try {
                    let r = await suggest();
                    setBoxes([
                      ...boxes,
                      ...r.boxes.map((a: any) => ({
                        skuId: sku,
                        x: Math.max(0, a.x),
                        y: Math.max(0, a.y),
                        w: Math.min(a.w, 1 - Math.max(0, a.x)),
                        h: Math.min(a.h, 1 - Math.max(0, a.y)),
                      })),
                    ]);
                    toast.info(
                      r.boxes.length
                        ? `${r.boxes.length} suggestions. Confirm the SKU for every box.`
                        : "No confident objects found. Draw boxes manually.",
                    );
                  } catch (e) {
                    toast.error((e as Error).message);
                  } finally {
                    setSuggesting(false);
                  }
                }}
              >
                {suggesting ? (
                  <Loader2 className="spin" size={15} />
                ) : (
                  <Sparkles size={15} />
                )}
                Suggest object boxes
              </Button>
            </div>
            <p className="small">
              Suggestions find general objects. You confirm the exact SKU.
            </p>
            <h3>{boxes.length} labels</h3>
            <div className="box-list">
              {boxes.map((a, i) => (
                <div className={selected === i ? "selected" : ""} key={i}>
                  <button
                    onClick={() => {
                      setSelected(i);
                      setSku(a.skuId);
                    }}
                  >
                    {i + 1}.{" "}
                    {skus.find((s) => s.id === a.skuId)?.name || "Unknown SKU"}
                  </button>
                  <button
                    aria-label={`Remove box ${i + 1}`}
                    onClick={() => {
                      setBoxes(boxes.filter((_, k) => k !== i));
                      setSelected(-1);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <label>
              Dataset split
              <Choices
                label="Dataset split"
                value={split}
                onChange={setSplit}
                items={[
                  { value: "train", label: "Training" },
                  { value: "validation", label: "Validation · held out" },
                ]}
              />
            </label>
            <div className="button-stack">
              <Button
                disabled={!!busy || !skus.length}
                onClick={() => save(boxes, split, true)}
              >
                <Check size={16} />
                Approve & save
              </Button>
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={() => save(boxes, split, false)}
              >
                Save draft
              </Button>
            </div>
            <div className="delete-area">
              <button
                className="text-button error-text"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={14} />
                Delete image
              </button>
            </div>
            <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this image?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently removes the uploaded image and its labels.
                    Existing trained models are retained.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep image</AlertDialogCancel>
                  <AlertDialogAction disabled={!!busy} onClick={remove}>
                    Delete image
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
