#!/usr/bin/env node
// Validation script of the expert-teams plugin. Only Node.js >= 18; the YAML parser js-yaml is vendored in vendor/.
//
//   node validate.mjs args <word> [<word> ...]   split and check the arguments of /expert-teams:run
//   node validate.mjs pipeline <name>            check .claude/expert-teams/pipelines/<name>.yaml and its status files
//   node validate.mjs new-name <name>            check whether a new pipeline name is valid and free
//   node validate.mjs setup <file>               check a create or modify draft against the schema
//   node validate.mjs list                       list the existing pipelines
//
// Options: --root <project-dir> (default: current directory)
//          --agents-dir <dir> (additional directory with agent files, may be repeated)
//
// Exit code 0 = fine, 1 = errors found, 2 = wrong usage.
// The output is JSON so the skill can read it unambiguously.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JSON_SCHEMA, load } from "./vendor/js-yaml.mjs";

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HITL_FLAGS = { "--autonomous": "autonomous", "--as-needed": "as-needed", "--always": "always" };

// ---------- Mini validator for the schema subset the plugin uses ----------

function loadSchema(file) {
  return JSON.parse(readFileSync(join(PLUGIN_ROOT, "schemas", file), "utf8"));
}

function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function resolveRef(root, ref) {
  if (!ref.startsWith("#/")) throw new Error(`Unsupported $ref: ${ref}`);
  return ref.slice(2).split("/").reduce((node, key) => node[key], root);
}

function validateSchema(value, schema, root, path, errors) {
  if (schema.$ref) {
    validateSchema(value, resolveRef(root, schema.$ref), root, path, errors);
  }
  const t = typeOf(value);
  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const ok = allowed.some((a) => a === t || (a === "number" && t === "integer"));
    if (!ok) {
      errors.push(`${path}: expected ${allowed.join(" or ")}, found ${t}`);
      return;
    }
  }
  if (schema.enum && !schema.enum.some((e) => e === value)) {
    errors.push(`${path}: ${JSON.stringify(value)} is not allowed (allowed: ${schema.enum.join(", ")})`);
  }
  if (t === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: must not be empty`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: "${value}" does not match the pattern ${schema.pattern}`);
    }
  }
  if (t === "integer" || t === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: must be at most ${schema.maximum}`);
  }
  if (t === "array") {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: needs at least ${schema.minItems} entries`);
    }
    if (schema.uniqueItems) {
      const seen = new Set();
      for (const item of value) {
        const key = JSON.stringify(item);
        if (seen.has(key)) errors.push(`${path}: entry ${key} is duplicated`);
        seen.add(key);
      }
    }
    if (schema.items) value.forEach((item, i) => validateSchema(item, schema.items, root, `${path}[${i}]`, errors));
  }
  if (t === "object") {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${path}: required field "${key}" is missing`);
    }
    const props = schema.properties ?? {};
    for (const [key, v] of Object.entries(value)) {
      if (key in props) {
        validateSchema(v, props[key], root, `${path}.${key}`, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}: unknown field "${key}"`);
      } else if (typeof schema.additionalProperties === "object") {
        validateSchema(v, schema.additionalProperties, root, `${path}.${key}`, errors);
      }
    }
  }
}

export function checkAgainst(schemaFile, value, label) {
  const schema = loadSchema(schemaFile);
  const errors = [];
  validateSchema(value, schema, schema, label, errors);
  return errors;
}

// JSON_SCHEMA keeps unquoted values like 2026-10-20 or yes as plain strings.
export function readYaml(file, errors) {
  try {
    return load(readFileSync(file, "utf8"), { schema: JSON_SCHEMA, filename: file });
  } catch (e) {
    errors.push(`${file}: not valid YAML (${e.message})`);
    return undefined;
  }
}

// ---------- Checks a schema cannot express ----------

function agentDirs(root, extra) {
  return [join(root, ".claude", "agents"), join(homedir(), ".claude", "agents"), ...extra];
}

function agentExists(name, dirs) {
  return dirs.some((d) => existsSync(join(d, `${name}.md`)));
}

function findCycle(phases) {
  const deps = new Map(phases.map((p) => [p.id, p.dependsOn ?? []]));
  const state = new Map();
  const stack = [];
  const visit = (id) => {
    if (state.get(id) === "done") return null;
    if (state.get(id) === "active") return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, "active");
    stack.push(id);
    for (const d of deps.get(id) ?? []) {
      if (!deps.has(d)) continue;
      const c = visit(d);
      if (c) return c;
    }
    stack.pop();
    state.set(id, "done");
    return null;
  };
  for (const id of deps.keys()) {
    const c = visit(id);
    if (c) return c;
  }
  return null;
}

function checkSemantics(pipeline, name, dirs) {
  const errors = [];
  const warnings = [];
  if (pipeline.name !== name) errors.push(`name is "${pipeline.name}", but the file is called ${name}.yaml`);

  const rules = pipeline.rules;
  const hasAskHumanWhen = (rules.askHumanWhen ?? []).length > 0;
  const levels = new Set([rules.humanInTheLoop ?? "as-needed", ...pipeline.phases.map((p) => p.humanInTheLoop).filter(Boolean)]);
  if (levels.has("as-needed") && !hasAskHumanWhen) {
    warnings.push("humanInTheLoop is as-needed, but rules.askHumanWhen is empty, so no question goes to the user");
  }
  if (hasAskHumanWhen && !levels.has("as-needed")) {
    warnings.push("rules.askHumanWhen is set, but no phase uses humanInTheLoop as-needed, so it has no effect");
  }
  const consultEnabled = rules.consult?.enabled !== false;

  const ids = pipeline.phases.map((p) => p.id);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  for (const id of new Set(dup)) errors.push(`Phase "${id}" is duplicated`);

  const agents = new Set();
  for (const p of pipeline.phases) {
    const where = `Phase "${p.id}"`;
    for (const d of p.dependsOn ?? []) {
      if (d === p.id) errors.push(`${where} depends on itself`);
      else if (!ids.includes(d)) errors.push(`${where}: dependsOn names unknown phase "${d}"`);
    }
    const parts = p.participants ?? [];
    if (!p.workPackages) {
      if (!parts.some((x) => x.mode === "build")) errors.push(`${where} needs at least one role with mode build`);
      if (!parts.some((x) => x.mode === "review")) errors.push(`${where} needs at least one role with mode review`);
    }
    for (const x of parts) {
      agents.add(x.agent);
      if (x.mode === "build" && !(x.outputs?.length > 0)) {
        errors.push(`${where}: role "${x.agent}" (build) needs outputs`);
      }
      if (x.mode === "review" && x.outputs?.length) {
        warnings.push(`${where}: role "${x.agent}" (review) has outputs, but review roles do not change files`);
      }
      for (const c of x.consultWith ?? []) {
        agents.add(c);
        if (c === x.agent) errors.push(`${where}: role "${x.agent}" lists itself in consultWith`);
      }
      if (x.consultWith?.length && !consultEnabled) {
        warnings.push(`${where}: role "${x.agent}" has consultWith, but rules.consult.enabled is false`);
      }
    }
    const roleKeys = new Set();
    for (const x of parts) {
      const key = `${x.agent}/${x.mode}`;
      if (roleKeys.has(key)) errors.push(`${where}: role "${x.agent}" is listed twice with mode ${x.mode}`);
      roleKeys.add(key);
    }
    if (p.workPackages) {
      const wp = p.workPackages;
      Object.values(wp.builderByType).forEach((a) => agents.add(a));
      Object.values(wp.reviewersByType).flat().forEach((a) => agents.add(a));
      for (const type of Object.keys(wp.builderByType)) {
        if (!wp.reviewersByType[type]) errors.push(`${where}: workPackages has no reviewer for type "${type}"`);
      }
      for (const type of Object.keys(wp.reviewersByType)) {
        if (!wp.builderByType[type]) errors.push(`${where}: workPackages has no builder for type "${type}"`);
      }
    }
    if (p.code && !rules.preCommit) {
      warnings.push(`${where} is a code phase, but rules.preCommit is empty`);
    }
  }

  const cycle = findCycle(pipeline.phases);
  if (cycle) errors.push(`Cycle in dependsOn: ${cycle.join(" -> ")}`);

  for (const a of [...agents].sort()) {
    if (!agentExists(a, dirs)) errors.push(`Agent "${a}" has no file ${a}.md in ${dirs.join(", ")}`);
  }
  return { errors, warnings };
}

function checkStatusFiles(root, name, phaseIds) {
  const errors = [];
  const dir = join(root, "docs", "pipeline-status", name);
  if (!existsSync(dir)) return { errors, done: [] };
  const done = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".yaml")).sort()) {
    const file = join(dir, f);
    const data = readYaml(file, errors);
    if (data === undefined) continue;
    errors.push(...checkAgainst("status.schema.json", data, f));
    const id = f.slice(0, -5);
    if (data.pipeline !== undefined && data.pipeline !== name) errors.push(`${f}: pipeline is "${data.pipeline}", expected "${name}"`);
    if (data.phase !== undefined && data.phase !== id) errors.push(`${f}: phase is "${data.phase}", expected "${id}"`);
    const phase = phaseIds.find((p) => id === p || id.startsWith(`${p}-`));
    if (!phase) errors.push(`${f}: belongs to no phase of the pipeline`);
    if (data.status === "done" && phaseIds.includes(id)) done.push(id);
  }
  return { errors, done };
}

// ---------- Commands ----------

function listPipelines(root) {
  const dir = join(root, ".claude", "expert-teams", "pipelines");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") && statSync(join(dir, f)).isFile())
    .map((f) => f.slice(0, -5))
    .sort();
}

function cmdList(root) {
  return { ok: true, pipelines: listPipelines(root) };
}

function cmdArgs(root, allWords) {
  const pipelines = listPipelines(root);
  const fail = (error) => ({ ok: false, error, pipelines });
  const flags = allWords.filter((w) => w.startsWith("--"));
  const words = allWords.filter((w) => !w.startsWith("--"));
  const unknown = flags.filter((f) => !(f in HITL_FLAGS));
  if (unknown.length) return fail(`Unknown option: ${unknown.join(" ")} (allowed: ${Object.keys(HITL_FLAGS).join(", ")})`);
  if (flags.length > 1) return fail(`Only one of ${Object.keys(HITL_FLAGS).join(", ")} is allowed.`);
  const humanInTheLoop = flags.length ? HITL_FLAGS[flags[0]] : null;
  if (words.length === 0) return fail("No pipeline name given.");
  const [name, second, ...rest] = words;
  if (!SLUG.test(name) || !pipelines.includes(name)) {
    return fail(`"${name}" is not an existing pipeline.`);
  }
  if (rest.length > 0) return fail(`Too many arguments: ${allWords.join(" ")}`);
  if (second === undefined) return { ok: true, name, mode: "all", phase: null, humanInTheLoop };
  if (second === "status") return { ok: true, name, mode: "status", phase: null, humanInTheLoop };
  const errors = [];
  const pipeline = readYaml(join(root, ".claude", "expert-teams", "pipelines", `${name}.yaml`), errors);
  const phaseIds = Array.isArray(pipeline?.phases) ? pipeline.phases.map((p) => p.id) : [];
  if (!phaseIds.includes(second)) {
    return { ...fail(`"${second}" is neither "status" nor a phase of ${name}.`), phases: phaseIds };
  }
  return { ok: true, name, mode: "phase", phase: second, humanInTheLoop };
}

function cmdPipeline(root, name, extraDirs) {
  if (!name || !SLUG.test(name)) return { ok: false, errors: [`Invalid name "${name ?? ""}"`] };
  const file = join(root, ".claude", "expert-teams", "pipelines", `${name}.yaml`);
  if (!existsSync(file)) return { ok: false, errors: [`${file} does not exist`], pipelines: listPipelines(root) };
  const errors = [];
  const pipeline = readYaml(file, errors);
  if (pipeline === undefined) return { ok: false, errors };
  errors.push(...checkAgainst("pipeline.schema.json", pipeline, name));
  if (errors.length) return { ok: false, errors };
  const sem = checkSemantics(pipeline, name, agentDirs(root, extraDirs));
  const phaseIds = pipeline.phases.map((p) => p.id);
  const status = checkStatusFiles(root, name, phaseIds);
  const all = [...sem.errors, ...status.errors];
  return { ok: all.length === 0, errors: all, warnings: sem.warnings, phases: phaseIds, done: status.done };
}

function cmdNewName(root, name) {
  const errors = [];
  if (!name || !SLUG.test(name)) {
    errors.push(`"${name ?? ""}" is not a valid name: only lowercase letters, digits and single hyphens, e.g. optimize-performance`);
  } else {
    if (existsSync(join(root, ".claude", "expert-teams", "pipelines", `${name}.yaml`))) errors.push(`.claude/expert-teams/pipelines/${name}.yaml already exists`);
    if (existsSync(join(root, ".claude", "skills", name))) errors.push(`A skill .claude/skills/${name}/ already exists`);
    if (existsSync(join(root, "docs", "pipeline-status", name))) errors.push(`docs/pipeline-status/${name}/ already exists`);
  }
  return { ok: errors.length === 0, errors };
}

function cmdSetup(root, file) {
  if (!file) return { ok: false, errors: ["No file given"] };
  const errors = [];
  const data = readYaml(resolve(file), errors);
  if (data !== undefined) errors.push(...checkAgainst("setup.schema.json", data, "draft"));
  if (!errors.length && data.kind === "modify") {
    if (!data.name) errors.push("draft: a modify draft needs the name of the pipeline it changes");
    else if (!existsSync(join(root, ".claude", "expert-teams", "pipelines", `${data.name}.yaml`))) {
      errors.push(`draft: .claude/expert-teams/pipelines/${data.name}.yaml does not exist`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function parseArgv(argv) {
  const positional = [];
  const opts = { root: process.cwd(), agentsDirs: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") opts.root = resolve(argv[++i]);
    else if (argv[i] === "--agents-dir") opts.agentsDirs.push(resolve(argv[++i]));
    else if (argv[i] === "--") positional.push(...argv.slice(i + 1)), (i = argv.length);
    else positional.push(argv[i]);
  }
  return { positional, opts };
}

export function run(argv) {
  const { positional, opts } = parseArgv(argv);
  const [cmd, ...rest] = positional;
  switch (cmd) {
    case "args":
      return cmdArgs(opts.root, rest);
    case "pipeline":
      return cmdPipeline(opts.root, rest[0], opts.agentsDirs);
    case "new-name":
      return cmdNewName(opts.root, rest[0]);
    case "setup":
      return cmdSetup(opts.root, rest[0]);
    case "list":
      return cmdList(opts.root);
    default:
      return { ok: false, usage: true, errors: ["Usage: node validate.mjs args|pipeline|new-name|setup|list ..."] };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = run(process.argv.slice(2));
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.usage ? 2 : result.ok ? 0 : 1);
}
