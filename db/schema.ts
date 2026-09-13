import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    created: text("created").notNull(),
  },
  (t) => [index("workspace_owner").on(t.owner)],
);
export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    name: text("name").notNull(),
    created: text("created").notNull(),
    productionJob: text("production_job"),
  },
  (t) => [index("project_workspace").on(t.workspaceId)],
);
export const skus = sqliteTable(
  "skus",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    name: text("name").notNull(),
    color: text("color").notNull(),
  },
  (t) => [uniqueIndex("sku_name").on(t.projectId, t.name)],
);
export const images = sqliteTable(
  "images",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    name: text("name").notNull(),
    key: text("key").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    split: text("split").notNull().default("train"),
    reviewed: integer("reviewed").notNull().default(0),
    annotations: text("annotations").notNull().default("[]"),
    created: text("created").notNull(),
    digest: text("digest").notNull(),
  },
  (t) => [uniqueIndex("image_digest").on(t.projectId, t.digest)],
);
export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    status: text("status").notNull(),
    created: text("created").notNull(),
    updated: text("updated").notNull(),
    progress: integer("progress").notNull().default(0),
    message: text("message").notNull().default(""),
    metrics: text("metrics"),
    classes: text("classes").notNull(),
    snapshot: text("snapshot").notNull(),
    provider: text("provider").notNull().default("torchvision"),
    artifactKey: text("artifact_key"),
  },
  (t) => [index("job_project").on(t.projectId)],
);
export const packs = sqliteTable(
  "packs",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    visibility: text("visibility").notNull(),
    terms: text("terms").notNull(),
    created: text("created").notNull(),
  },
  (t) => [index("pack_owner").on(t.owner)],
);
export const licenses = sqliteTable(
  "licenses",
  {
    id: text("id").primaryKey(),
    packId: text("pack_id")
      .notNull()
      .references(() => packs.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    owner: text("owner").notNull(),
    status: text("status").notNull(),
    terms: text("terms").notNull(),
    created: text("created").notNull(),
  },
  (t) => [uniqueIndex("pack_project").on(t.packId, t.projectId)],
);
export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  hash: text("hash").notNull().unique(),
  created: text("created").notNull(),
});
export const usage = sqliteTable("usage", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  jobId: text("job_id").notNull(),
  packId: text("pack_id"),
  created: text("created").notNull(),
  detections: integer("detections").notNull(),
});
