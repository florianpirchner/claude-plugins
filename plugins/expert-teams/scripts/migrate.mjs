#!/usr/bin/env node
// Migration script of the expert-teams plugin: brings pipelines of older plugin versions into the current layout.
//
//   node migrate.mjs [--root <project-dir>]                      plan only: what would change, nothing is written
//   node migrate.mjs --apply --language <code>[,<docs>,<ui>] ... write the plan
//
// Old layout (pipeline-plugin, fp, expert-teams up to 0.5.0)    current layout
//   .claude/pipelines/<name>.json                              .claude/expert-teams/pipelines/<name>.yaml
//   .claude/pipelines/.drafts/*.json, .entwuerfe/*.json        .claude/expert-teams/drafts/*.yaml
//   docs/pipeline-status/<name>/*.json                         docs/pipeline-status/<name>/*.yaml
//   docs/entscheidungen/<name>/                                docs/decisions/<name>/
//   .claude/skills/<name>/SKILL.md pointing to the JSON file   the same skill pointing to the YAML file
//
// Phase ids, branch names and file contents stay as they are. Two rules are added if missing, because their
// defaults would change a running project: rules.language (--language, the language the project is written in)
// and, if phases are already done on baseBranch, rules.integrationBranch: none (keeps merging into baseBranch).
// Every pipeline without domains (JSON or YAML, expert-teams up to 0.12.0) gets domains: [software], the only
// field of work those versions knew.
// JSON status files next to a YAML pipeline (written by a run of an older version) become YAML too.
// Every pipeline of schemaVersion 1 (expert-teams up to 0.14.0: one participants list with mode build or review,
// consultWith per role) gets schemaVersion 2: builder (exactly one), reviewers and consultants (the union of all
// consultWith of the phase). A phase with several builders that is not done yet is split: the first builder keeps
// the phase id, every further builder gets its own phase <id>-<agent> with the same goal, inputs, reviewers and
// acceptance, and phases that depended on <id> also depend on the new ones. A done phase is not split, because it
// does not run again: it keeps its first builder and the plan notes the others. For YAML files the comments are
// kept unless a phase is split; then the file is written anew with its header.
// Running it again after --apply finds nothing to do. Output is JSON; exit code 0 = fine, 1 = errors, 2 = usage.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DOMAINS, checkAgainst, isVersion1, readStatusFiles, readYaml, statusRef } from "./validate.mjs";
import { JSON_SCHEMA, dump, load } from "./vendor/js-yaml.mjs";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LANG = /^[a-z]{2}$/;

function readJson(file, errors) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    errors.push(`${file}: not valid JSON (${e.message})`);
    return undefined;
  }
}

function toYaml(data, header) {
  const body = dump(data, { schema: JSON_SCHEMA, lineWidth: -1, noRefs: true });
  return (header ? header.map((l) => `# ${l}`).join("\n") + "\n" : "") + body;
}

function files(dir, ext) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(ext) && statSync(join(dir, f)).isFile()).sort();
}

// Inserts a comment line above the first line "  <key>:" inside the rules block.
function commentRule(yaml, key, comment) {
  return yaml.replace(new RegExp(`^(rules:\\n(?:  .*\\n)*?)(  ${key}:)`, "m"), `$1  # ${comment}\n$2`);
}

const DOMAINS_COMMENT = "# Added by the migration: domain packs whose knowledge create, modify and run load. Older versions only knew software.";

// Puts domains right after description, where /expert-teams:create writes it.
function withDomains(pipeline) {
  const out = {};
  for (const [k, v] of Object.entries(pipeline)) {
    if (k === "inputs" || k === "rules" || k === "phases") out.domains ??= [...DEFAULT_DOMAINS];
    out[k] = v;
  }
  out.domains ??= [...DEFAULT_DOMAINS];
  return out;
}

// Inserts domains above the first top-level inputs, rules or phases line, keeping every comment of the file.
function addDomainsToYaml(yaml) {
  const block = `${DOMAINS_COMMENT}\ndomains:\n${DEFAULT_DOMAINS.map((d) => `  - ${d}`).join("\n")}\n`;
  const lines = yaml.split("\n");
  const key = lines.findIndex((l) => /^(inputs|rules|phases):/.test(l));
  if (key === -1) return yaml.replace(/\n*$/, "\n") + block;
  // Comment lines right above the key belong to it, so the block goes above them; at the top they are the file header.
  let at = key;
  while (at > 0 && lines[at - 1].startsWith("#")) at--;
  if (at === 0) at = key;
  return [...lines.slice(0, at), block.slice(0, -1), ...lines.slice(at)].join("\n");
}

// ---------- schemaVersion 1 -> 2: one builder, reviewers and consultants per phase ----------

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

// The roles of one phase in the new form, for the given builder (null for a phase with work packages).
function roles(parts, builder) {
  const out = {};
  if (builder) out.builder = pick(builder, ["agent", "task", "focus", "outputs"]);
  const reviewers = parts.filter((x) => x.mode === "review" && x.agent !== builder?.agent).map((x) => pick(x, ["agent", "task", "focus"]));
  if (reviewers.length) out.reviewers = reviewers;
  const consultants = [...new Set(parts.flatMap((x) => x.consultWith ?? []))].filter((a) => a !== builder?.agent);
  if (consultants.length) out.consultants = consultants.map((agent) => ({ agent }));
  return out;
}

// Replaces participants at its place in the phase, so the keys keep their order.
function withRoles(phase, newRoles, extra = {}) {
  const out = {};
  for (const [k, v] of Object.entries({ ...phase, ...extra })) {
    if (k === "participants") Object.assign(out, newRoles);
    else out[k] = v;
  }
  return out;
}

// Converts the phases of a version 1 pipeline. done: ids of finished phases, which are never split.
export function convertPhases(name, phases, done, plan) {
  const ids = phases.map((p) => p.id);
  const result = [];
  const splits = new Map();
  for (const p of phases) {
    if (!("participants" in p)) {
      result.push(p);
      continue;
    }
    const parts = p.participants ?? [];
    const builders = parts.filter((x) => x.mode === "build");
    for (const b of builders) {
      if (parts.some((x) => x.mode === "review" && x.agent === b.agent)) {
        plan.notes.push(`${name}/${p.id}: "${b.agent}" was builder and reviewer; it stays builder only, because a builder does not review its own results.`);
      }
    }
    if (p.workPackages) {
      if (builders.length || parts.some((x) => x.mode === "review")) {
        plan.errors.push(`${name}/${p.id}: has workPackages and participants; move the roles into workPackages.builderByType and reviewersByType by hand`);
      }
      result.push(withRoles(p, roles(parts, null)));
      continue;
    }
    if (builders.length === 0) plan.errors.push(`${name}/${p.id}: has no role with mode build; add a builder by hand`);
    if (builders.length <= 1) {
      result.push(withRoles(p, roles(parts, builders[0])));
      continue;
    }
    const [first, ...others] = builders;
    if (done.includes(p.id)) {
      result.push(withRoles(p, roles(parts, first)));
      plan.notes.push(
        `${name}/${p.id} had ${builders.length} builders and is done, so it is not split: ${first.agent} stays builder, ` +
          `${others.map((b) => b.agent).join(", ")} ${others.length === 1 ? "is" : "are"} dropped from the pipeline file (the delivered results stay).`,
      );
      continue;
    }
    const newIds = others.map((b) => `${p.id}-${b.agent}`);
    for (const id of newIds) if (ids.includes(id)) plan.errors.push(`${name}/${p.id}: cannot split, phase "${id}" already exists`);
    result.push(withRoles(p, roles(parts, first)));
    others.forEach((b, i) => result.push(withRoles(p, roles(parts, b), { id: newIds[i] })));
    splits.set(p.id, newIds);
    plan.notes.push(
      `${name}/${p.id} had ${builders.length} builders and is split: ${first.agent} keeps ${p.id}, ` +
        others.map((b, i) => `${b.agent} builds ${newIds[i]}`).join(", ") +
        ". Each part keeps goal, inputs, reviewers and acceptance; check the tasks and acceptance criteria with /expert-teams:modify.",
    );
  }
  for (const p of result) {
    if (!p.dependsOn?.some((d) => splits.has(d))) continue;
    p.dependsOn = p.dependsOn.flatMap((d) => [d, ...(splits.get(d) ?? [])]);
  }
  return { phases: result, splits };
}

// Rewrites each participants block in place, keeping every other line and comment of the file.
function replaceParticipantsInYaml(yaml, phases) {
  const lines = yaml.split("\n");
  const out = [];
  const withRolesQueue = phases.filter((p) => p.builder || p.reviewers || p.consultants || p.workPackages);
  let k = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)participants:/.exec(lines[i]);
    if (!m) {
      out.push(lines[i]);
      continue;
    }
    const indent = m[1].length;
    let end = i + 1;
    while (end < lines.length && (lines[end].trim() === "" || lines[end].search(/\S/) > indent)) end++;
    while (end > i + 1 && lines[end - 1].trim() === "") end--;
    // The k-th participants block belongs to the k-th phase that had one.
    const phase = withRolesQueue[k++];
    const block = pick(phase ?? {}, ["builder", "reviewers", "consultants"]);
    if (Object.keys(block).length) {
      out.push(...dump(block, { schema: JSON_SCHEMA, lineWidth: -1, noRefs: true }).replace(/\n$/, "").split("\n").map((l) => " ".repeat(indent) + l));
    }
    i = end - 1;
  }
  return out.join("\n").replace(/^schemaVersion: 1\s*$/m, "schemaVersion: 2");
}

function convertedYaml(name, yaml, pipeline, done, plan) {
  const old = pipeline.phases.filter((p) => "participants" in p);
  const { phases, splits } = convertPhases(name, pipeline.phases, done, plan);
  if (splits.size === 0) return replaceParticipantsInYaml(yaml, phases.filter((p) => old.some((o) => o.id === p.id)));
  // Splits change the phase list, so the file is written anew; only the header comment is kept.
  const header = yaml.split("\n").filter((l, i, all) => all.slice(0, i + 1).every((x) => x.startsWith("#"))).join("\n");
  let body = dump({ ...pipeline, schemaVersion: 2, phases }, { schema: JSON_SCHEMA, lineWidth: -1, noRefs: true });
  for (const [id, newIds] of splits) {
    for (const n of newIds) body = body.replace(`\n  - id: ${n}\n`, `\n  # Split from ${id} by the migration: one builder per phase.\n  - id: ${n}\n`);
  }
  plan.notes.push(`.claude/expert-teams/pipelines/${name}.yaml is written anew because of the split; comments other than the header are dropped.`);
  return (header ? header + "\n" : "") + body;
}

// Status files an older plugin version wrote as JSON next to a YAML pipeline.
function planJsonStatusFiles(root, name, plan) {
  const rel = (p) => relative(root, p).split("\\").join("/");
  const statusDir = join(root, "docs", "pipeline-status", name);
  for (const f of files(statusDir, ".json")) {
    const data = readJson(join(statusDir, f), plan.errors);
    if (!data) continue;
    const to = join(statusDir, f.replace(/\.json$/, ".yaml"));
    if (existsSync(to)) {
      plan.errors.push(`${rel(to)} already exists next to ${f}`);
      continue;
    }
    plan.errors.push(...checkAgainst("status.schema.json", data, rel(join(statusDir, f))));
    plan.steps.push({ op: "convert", from: rel(join(statusDir, f)), to: rel(to), content: toYaml(data) });
  }
}

function planYamlPipeline(root, name, plan) {
  const file = join(root, ".claude", "expert-teams", "pipelines", `${name}.yaml`);
  const errors = [];
  const pipeline = readYaml(file, errors);
  if (pipeline === undefined) return plan.errors.push(...errors);
  if (pipeline === null || typeof pipeline !== "object") return;
  planJsonStatusFiles(root, name, plan);
  const v1 = isVersion1(pipeline) && Array.isArray(pipeline.phases);
  if (!v1 && "domains" in pipeline) return;
  const added = [];
  let content = readFileSync(file, "utf8");
  if (v1) {
    const statusErrors = [];
    const done = readStatusFiles(root, name, statusRef(root, pipeline, name), statusErrors)
      .filter(({ data }) => data?.status === "done")
      .map(({ f }) => f.slice(0, -5));
    plan.errors.push(...statusErrors);
    content = convertedYaml(name, content, pipeline, done, plan);
    added.push("builder", "reviewers", "consultants");
  }
  if (!("domains" in pipeline)) {
    content = addDomainsToYaml(content);
    added.unshift("domains");
  }
  plan.errors.push(...checkAgainst("pipeline.schema.json", load(content, { schema: JSON_SCHEMA }), name));
  const rel = relative(root, file).split("\\").join("/");
  plan.steps.push({ op: "edit", from: rel, to: rel, content, added });
}

function planPipeline(root, name, opts, plan) {
  const rel = (p) => relative(root, p).split("\\").join("/");
  const src = join(root, ".claude", "pipelines", `${name}.json`);
  const dst = join(root, ".claude", "expert-teams", "pipelines", `${name}.yaml`);
  const errors = [];
  const pipeline = readJson(src, errors);
  if (!pipeline) return plan.errors.push(...errors);
  if (existsSync(dst)) return plan.errors.push(`${rel(dst)} already exists: remove one of ${rel(src)} and ${rel(dst)} first`);

  const statusDir = join(root, "docs", "pipeline-status", name);
  const doneIds = files(statusDir, ".json")
    .filter((f) => readJson(join(statusDir, f), [])?.status === "done")
    .map((f) => f.slice(0, -5));
  const doneOnBase = doneIds.length > 0;
  const rules = (pipeline.rules ??= {});
  const added = [];
  if (!rules.language) {
    if (opts.language) {
      rules.language = opts.language;
      added.push(["language", "Added by the migration: the language this project is written in. New projects default to English."]);
    } else {
      plan.decisions.push({
        pipeline: name,
        rule: "language",
        question: "Which language is the project written in (code, docs, UI)? Without rules.language the reviewers would expect English and flag the existing text.",
      });
    }
  }
  if (!rules.integrationBranch && doneOnBase) {
    rules.integrationBranch = "none";
    added.push(["integrationBranch", `Added by the migration: phases are already merged into ${rules.baseBranch ?? "baseBranch"}, so the run keeps doing that.`]);
  }
  const splitIds = [];
  if (Array.isArray(pipeline.phases)) {
    const { phases, splits } = convertPhases(name, pipeline.phases, doneIds, plan);
    pipeline.phases = phases;
    for (const newIds of splits.values()) splitIds.push(...newIds);
  }
  pipeline.schemaVersion = 2;
  const migrated = pipeline.domains ? pipeline : withDomains(pipeline);
  const schemaErrors = checkAgainst("pipeline.schema.json", migrated, name);
  // A missing language is a decision still to make, not an error of the old file.
  plan.errors.push(...schemaErrors);

  let yaml = toYaml(migrated, [`Pipeline ${name} of the expert-teams plugin. Schema: schemas/pipeline.schema.json`, `Migrated from .claude/pipelines/${name}.json.`]);
  if (!pipeline.domains) yaml = yaml.replace(/^domains:/m, `${DOMAINS_COMMENT}\ndomains:`);
  for (const [key, comment] of added) yaml = commentRule(yaml, key, comment);
  for (const id of splitIds) yaml = yaml.replace(`\n  - id: ${id}\n`, `\n  # Split by the migration: one builder per phase.\n  - id: ${id}\n`);
  const addedKeys = [...(pipeline.domains ? [] : ["domains"]), ...added.map(([k]) => k)];
  plan.steps.push({ op: "convert", from: rel(src), to: rel(dst), content: yaml, added: addedKeys });

  planJsonStatusFiles(root, name, plan);

  const oldDecisions = join(root, "docs", "entscheidungen", name);
  if (existsSync(oldDecisions)) {
    const newDecisions = join(root, "docs", "decisions", name);
    for (const f of files(oldDecisions, "")) {
      const to = join(newDecisions, f);
      if (existsSync(to)) plan.errors.push(`${rel(to)} and ${rel(join(oldDecisions, f))} both exist: merge them by hand`);
      else plan.steps.push({ op: "move", from: rel(join(oldDecisions, f)), to: rel(to) });
    }
  }

  const skill = join(root, ".claude", "skills", name, "SKILL.md");
  if (existsSync(skill)) {
    const text = readFileSync(skill, "utf8");
    const updated = text.split(`.claude/pipelines/${name}.json`).join(`.claude/expert-teams/pipelines/${name}.yaml`);
    if (updated !== text) plan.steps.push({ op: "edit", from: rel(skill), to: rel(skill), content: updated });
  }
}

export function makePlan(root, opts = {}) {
  const plan = { steps: [], decisions: [], notes: [], errors: [] };
  const rel = (p) => relative(root, p).split("\\").join("/");
  const oldDir = join(root, ".claude", "pipelines");
  for (const f of files(oldDir, ".json")) {
    const name = f.slice(0, -5);
    if (!SLUG.test(name)) plan.errors.push(`.claude/pipelines/${f}: "${name}" is not a valid pipeline name`);
    else planPipeline(root, name, opts, plan);
  }
  for (const f of files(join(root, ".claude", "expert-teams", "pipelines"), ".yaml")) {
    const name = f.slice(0, -5);
    if (SLUG.test(name)) planYamlPipeline(root, name, plan);
  }
  for (const d of [".drafts", ".entwuerfe"]) {
    const dir = join(oldDir, d);
    for (const f of files(dir, ".json")) {
      const data = readJson(join(dir, f), plan.errors);
      if (!data) continue;
      const to = join(root, ".claude", "expert-teams", "drafts", f.replace(/\.json$/, ".yaml"));
      if (existsSync(to)) plan.errors.push(`${rel(to)} already exists`);
      else plan.steps.push({ op: "convert", from: rel(join(dir, f)), to: rel(to), content: toYaml(data) });
      plan.notes.push(`${rel(join(dir, f))} is a draft of an older version; check it with validate.mjs setup before continuing it.`);
    }
  }
  if (existsSync(join(root, ".claude", "pipeline.json"))) {
    plan.notes.push(".claude/pipeline.json is from the first /pipeline skill, before the plugin. It is not migrated; recreate it with /expert-teams:create.");
  }
  for (const s of plan.steps.filter((s) => s.op === "convert" && s.from.includes("pipelines/") && !s.from.includes("/."))) {
    const p = JSON.parse(readFileSync(join(root, s.from), "utf8"));
    for (const ph of p.phases ?? []) {
      const from = ph.workPackages?.from;
      if (from?.endsWith(".json")) plan.notes.push(`${from} (work packages of ${ph.id}) stays JSON; the run reads it as it is.`);
    }
  }
  return plan;
}

function removeEmptyDirs(dir, stop) {
  while (dir.startsWith(stop) && dir !== stop && existsSync(dir) && readdirSync(dir).length === 0) {
    rmdirSync(dir);
    dir = dirname(dir);
  }
}

export function applyPlan(root, plan) {
  for (const s of plan.steps) {
    const from = join(root, s.from);
    const to = join(root, s.to);
    mkdirSync(dirname(to), { recursive: true });
    if (s.op === "move") renameSync(from, to);
    else {
      writeFileSync(to, s.content);
      if (s.op === "convert") rmSync(from);
    }
    removeEmptyDirs(dirname(from), root);
  }
}

function parseLanguage(value) {
  const parts = value.split(",");
  if (parts.length !== 1 && parts.length !== 3) return null;
  const [code, docs = code, ui = code] = parts;
  return [code, docs, ui].every((l) => LANG.test(l)) ? { code, docs, ui } : null;
}

export function migrate(argv) {
  const opts = { root: process.cwd(), apply: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") opts.root = resolve(argv[++i]);
    else if (argv[i] === "--apply") opts.apply = true;
    else if (argv[i] === "--language") {
      opts.language = parseLanguage(argv[++i] ?? "");
      if (!opts.language) return { ok: false, usage: true, errors: ["--language takes one code like de, or three like en,de,de (code, docs, UI)"] };
    } else return { ok: false, usage: true, errors: [`Unknown argument "${argv[i]}". Usage: node migrate.mjs [--root <dir>] [--apply --language <code>]`] };
  }
  const plan = makePlan(opts.root, opts);
  const summary = (applied) => ({
    ok: plan.errors.length === 0 && (!applied || plan.decisions.length === 0),
    applied,
    nothingToDo: plan.steps.length === 0,
    steps: plan.steps.map(({ content, ...s }) => s),
    pipelineYaml: Object.fromEntries(plan.steps.filter((s) => s.to.startsWith(".claude/expert-teams/pipelines/")).map((s) => [s.to, s.content])),
    decisions: plan.decisions,
    notes: plan.notes,
    errors: plan.errors,
  });
  if (!opts.apply || plan.steps.length === 0) return summary(false);
  if (plan.errors.length) return summary(false);
  if (plan.decisions.length) return { ...summary(false), ok: false, errors: ["Decide first: " + plan.decisions.map((d) => d.rule).join(", ")] };
  applyPlan(opts.root, plan);
  return summary(true);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = migrate(process.argv.slice(2));
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.usage ? 2 : result.ok ? 0 : 1);
}
