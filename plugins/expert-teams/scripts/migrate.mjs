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
// Running it again after --apply finds nothing to do. Output is JSON; exit code 0 = fine, 1 = errors, 2 = usage.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkAgainst } from "./validate.mjs";
import { JSON_SCHEMA, dump } from "./vendor/js-yaml.mjs";

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

function planPipeline(root, name, opts, plan) {
  const rel = (p) => relative(root, p).split("\\").join("/");
  const src = join(root, ".claude", "pipelines", `${name}.json`);
  const dst = join(root, ".claude", "expert-teams", "pipelines", `${name}.yaml`);
  const errors = [];
  const pipeline = readJson(src, errors);
  if (!pipeline) return plan.errors.push(...errors);
  if (existsSync(dst)) return plan.errors.push(`${rel(dst)} already exists: remove one of ${rel(src)} and ${rel(dst)} first`);

  const statusDir = join(root, "docs", "pipeline-status", name);
  const doneOnBase = files(statusDir, ".json").some((f) => readJson(join(statusDir, f), [])?.status === "done");
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
  pipeline.schemaVersion ??= 1;
  const schemaErrors = checkAgainst("pipeline.schema.json", pipeline, name);
  // A missing language is a decision still to make, not an error of the old file.
  plan.errors.push(...schemaErrors);

  let yaml = toYaml(pipeline, [`Pipeline ${name} of the expert-teams plugin. Schema: schemas/pipeline.schema.json`, `Migrated from .claude/pipelines/${name}.json.`]);
  for (const [key, comment] of added) yaml = commentRule(yaml, key, comment);
  plan.steps.push({ op: "convert", from: rel(src), to: rel(dst), content: yaml, added: added.map(([k]) => k) });

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
