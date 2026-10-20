#!/usr/bin/env node
// Writes a view of a pipeline and its state. Only Node.js >= 18, reuses the YAML reading of validate.mjs.
//
//   node visualize.mjs <name> [--root <project-dir>] [--out <dir>] [--run <file>]
//
// Writes into <out> (default: docs/pipeline-status/<name>/):
//   README.md      Mermaid flowchart top to bottom (GitHub shows it when you open the folder),
//                  each box with phase, builders and state, below it a list with the reviewers.
//   pipeline.html  a single file without dependencies; hover or click on a phase shows builders,
//                  reviewers, tasks, round and acceptance criteria.
//
// State per phase: done (status file with status done), running or waiting-for-user
// (.claude/expert-teams/runs/<name>.yaml, written by /expert-teams:run), startable (all
// dependencies done) or open. --run reads the run file from elsewhere, e.g. the project directory
// while --root is a worktree. The output is JSON, exit code 0 = written, 1 = error.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkAgainst, readYaml } from "./validate.mjs";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Mermaid class names without hyphens.
const MERMAID_CLASS = { done: "done", running: "running", "waiting-for-user": "waiting", startable: "startable", open: "open" };

const STATE_TEXT = {
  done: "done",
  running: "running",
  "waiting-for-user": "waiting for you",
  startable: "startable",
  open: "open",
};

// ---------- Reading ----------

function readDone(root, name, errors) {
  const dir = join(root, "docs", "pipeline-status", name);
  const done = {};
  if (!existsSync(dir)) return done;
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".yaml"))) {
    const data = readYaml(join(dir, f), errors);
    if (data?.status === "done") done[f.slice(0, -5)] = data;
  }
  return done;
}

function readRun(file, name, errors) {
  if (!existsSync(file)) return {};
  const data = readYaml(file, errors);
  if (data === undefined) return {};
  const schemaErrors = checkAgainst("run.schema.json", data, `runs/${name}.yaml`);
  errors.push(...schemaErrors);
  return schemaErrors.length === 0 ? data.phases : {};
}

const unique = (list) => [...new Set(list)];

function roles(phase, mode) {
  const fromParticipants = (phase.participants ?? []).filter((p) => p.mode === mode).map((p) => p.agent);
  const wp = phase.workPackages;
  if (!wp) return unique(fromParticipants);
  const fromPackages = mode === "build" ? Object.values(wp.builderByType ?? {}) : Object.values(wp.reviewersByType ?? {}).flat();
  return unique([...fromParticipants, ...fromPackages]);
}

function tasks(phase, mode) {
  const list = (phase.participants ?? []).filter((p) => p.mode === mode).map((p) => ({ agent: p.agent, task: p.task }));
  const wp = phase.workPackages;
  if (wp) list.push({ agent: "per work package", task: mode === "build" ? wp.task : wp.reviewTask });
  return list;
}

// Wave = 1 + highest wave of the dependencies, so phases of one wave can run in parallel.
function waves(phases) {
  const byId = new Map(phases.map((p) => [p.id, p]));
  const wave = new Map();
  const visit = (id, seen = new Set()) => {
    if (wave.has(id)) return wave.get(id);
    if (seen.has(id) || !byId.has(id)) return 0;
    seen.add(id);
    const deps = byId.get(id).dependsOn ?? [];
    const w = deps.length === 0 ? 1 : 1 + Math.max(...deps.map((d) => visit(d, seen)));
    wave.set(id, w);
    return w;
  };
  phases.forEach((p) => visit(p.id));
  return wave;
}

export function buildModel(root, name, runFile = join(root, ".claude", "expert-teams", "runs", `${name}.yaml`)) {
  const errors = [];
  const file = join(root, ".claude", "expert-teams", "pipelines", `${name}.yaml`);
  if (!existsSync(file)) return { errors: [`${file} does not exist`] };
  const pipeline = readYaml(file, errors);
  if (!pipeline || !Array.isArray(pipeline.phases)) return { errors: errors.length ? errors : [`${file} has no phases`] };
  const done = readDone(root, name, errors);
  const running = readRun(runFile, name, errors);
  const wave = waves(pipeline.phases);
  const phases = pipeline.phases.map((p) => {
    const deps = p.dependsOn ?? [];
    let state;
    if (done[p.id]) state = "done";
    else if (running[p.id]) state = running[p.id].status;
    else state = deps.every((d) => done[d]) ? "startable" : "open";
    return {
      id: p.id,
      goal: p.goal,
      dependsOn: deps,
      wave: wave.get(p.id),
      state,
      round: done[p.id]?.rounds ?? running[p.id]?.round ?? null,
      question: running[p.id]?.question ?? null,
      waitingFor: state === "open" ? deps.filter((d) => !done[d]) : [],
      builders: roles(p, "build"),
      reviewers: roles(p, "review"),
      buildTasks: tasks(p, "build"),
      reviewTasks: tasks(p, "review"),
      acceptance: p.acceptance ?? [],
    };
  });
  return { errors, name, description: pipeline.description ?? "", phases };
}

// ---------- Markdown with Mermaid ----------

// Mermaid labels: no quotes, brackets or HTML from the data.
const label = (text) => String(text).replace(/["<>{}[\]|#]/g, " ").replace(/\s+/g, " ").trim();

function stateLine(p) {
  const text = STATE_TEXT[p.state];
  if (p.state === "running" && p.round) return `${text}, round ${p.round}`;
  if (p.state === "done" && p.round) return `${text}, ${p.round} ${p.round === 1 ? "round" : "rounds"}`;
  return text;
}

export function renderMarkdown(model, generatedAt) {
  const index = new Map(model.phases.map((p, i) => [p.id, `p${i}`]));
  const lines = ["```mermaid", "flowchart TD"];
  for (const p of model.phases) {
    const builders = p.builders.length ? `B: ${p.builders.join(", ")}` : "B: none";
    lines.push(`  ${index.get(p.id)}["<b>${label(p.id)}</b><br/>${label(builders)}<br/>${label(stateLine(p))}"]:::${MERMAID_CLASS[p.state]}`);
  }
  for (const p of model.phases) {
    for (const d of p.dependsOn) if (index.has(d)) lines.push(`  ${index.get(d)} --> ${index.get(p.id)}`);
  }
  lines.push(
    "  classDef done fill:#d8f0dc,stroke:#2e7d32,color:#1b3a20",
    "  classDef running fill:#fff1c2,stroke:#b7860b,color:#4a3700",
    "  classDef waiting fill:#fadbd8,stroke:#c62828,color:#4a1010",
    "  classDef startable fill:#eef1f4,stroke:#5b6b7b,color:#1f2a35",
    "  classDef open fill:#eeeeee,stroke:#9e9e9e,color:#4a4a4a",
    "```",
  );

  const count = (s) => model.phases.filter((p) => p.state === s).length;
  const summary = Object.keys(STATE_TEXT)
    .filter((s) => count(s) > 0)
    .map((s) => `${count(s)} ${STATE_TEXT[s]}`)
    .join(", ");

  const list = model.phases.map((p) => {
    let line = `- **${p.id}** (${stateLine(p)}): reviewers ${p.reviewers.length ? p.reviewers.join(", ") : "none"}`;
    if (p.state === "waiting-for-user" && p.question) line += `. Question: ${p.question}`;
    if (p.state === "open" && p.waitingFor.length) line += `. Waits for ${p.waitingFor.join(", ")}`;
    return line;
  });

  return [
    `# ${model.name}`,
    "",
    model.description,
    "",
    `State: ${summary}. Generated ${generatedAt} by \`/expert-teams:status\`. Details per phase: open \`pipeline.html\` in this folder in a browser.`,
    "",
    ...lines,
    "",
    "## Reviewers and state",
    "",
    ...list,
    "",
  ].join("\n");
}

// ---------- HTML ----------

const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function renderHtml(model, generatedAt) {
  const data = JSON.stringify({ ...model, stateText: STATE_TEXT }).replace(/</g, "\\u003c");
  const maxWave = Math.max(1, ...model.phases.map((p) => p.wave ?? 1));
  const rows = [];
  for (let w = 1; w <= maxWave; w++) {
    const cards = model.phases
      .filter((p) => (p.wave ?? 1) === w)
      .map(
        (p) =>
          `<button class="phase ${p.state}" data-id="${escapeHtml(p.id)}" title="${escapeHtml(p.goal)}">` +
          `<strong>${escapeHtml(p.id)}</strong><span>B: ${escapeHtml(p.builders.join(", ") || "none")}</span>` +
          `<span class="state">${escapeHtml(stateLine(p))}</span></button>`,
      )
      .join("");
    rows.push(`<section class="wave"><h2>Wave ${w}</h2><div class="cards">${cards}</div></section>`);
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(model.name)}</title>
<style>
:root { --bg: #ffffff; --fg: #1f2328; --muted: #59636e; --panel: #f6f8fa; --line: #d1d9e0;
  --done: #d8f0dc; --done-line: #2e7d32; --running: #fff1c2; --running-line: #b7860b;
  --waiting: #fadbd8; --waiting-line: #c62828; --startable: #eef1f4; --startable-line: #5b6b7b;
  --open: #eeeeee; --open-line: #9e9e9e; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #0d1117; --fg: #e6edf3; --muted: #9198a1; --panel: #161b22; --line: #30363d;
    --done: #12301a; --done-line: #3fb950; --running: #3a2f0b; --running-line: #d29922;
    --waiting: #3d1414; --waiting-line: #f85149; --startable: #1c2430; --startable-line: #8b98a8;
    --open: #21262d; --open-line: #6e7681; }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg);
  font: 16px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 760px; margin: 0 auto; }
h1 { font-size: 1.4rem; margin: 0 0 4px; }
p.meta { color: var(--muted); margin: 0 0 16px; }
.wave h2 { font-size: .8rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 16px 0 6px; }
.cards { display: flex; flex-wrap: wrap; gap: 8px; }
.phase { flex: 1 1 200px; text-align: left; cursor: pointer; font: inherit; color: var(--fg);
  border: 2px solid var(--line); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 2px; }
.phase span { font-size: .9rem; }
.phase .state { color: var(--muted); }
.phase.selected { outline: 3px solid var(--fg); outline-offset: 1px; }
.done { background: var(--done); border-color: var(--done-line); }
.running { background: var(--running); border-color: var(--running-line); }
.waiting-for-user { background: var(--waiting); border-color: var(--waiting-line); }
.startable { background: var(--startable); border-color: var(--startable-line); }
.open { background: var(--open); border-color: var(--open-line); }
#details { margin-top: 20px; padding: 14px 16px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; }
#details h3 { margin: 0 0 6px; }
#details h4 { margin: 12px 0 4px; font-size: .95rem; }
#details ul { margin: 0; padding-left: 20px; }
#details p { margin: 0; }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(model.name)}</h1>
<p class="meta">${escapeHtml(model.description)}<br>Generated ${escapeHtml(generatedAt)}. Hover or tap a phase for details.</p>
${rows.join("\n")}
<div id="details"><p>Hover or tap a phase.</p></div>
</main>
<script>
const model = ${data};
const byId = new Map(model.phases.map((p) => [p.id, p]));
const details = document.getElementById("details");
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const list = (items) => items.length ? "<ul>" + items.map((i) => "<li>" + i + "</li>").join("") + "</ul>" : "<p>none</p>";
let pinned = null;
function show(id) {
  const p = byId.get(id);
  let state = model.stateText[p.state];
  if (p.round) state += ", round " + p.round;
  if (p.question) state += ". Question: " + p.question;
  if (p.waitingFor.length) state += ". Waits for " + p.waitingFor.join(", ");
  details.innerHTML =
    "<h3>" + esc(p.id) + "</h3><p>" + esc(p.goal) + "</p>" +
    "<h4>State</h4><p>" + esc(state) + "</p>" +
    "<h4>Builders</h4>" + list(p.buildTasks.map((t) => "<strong>" + esc(t.agent) + "</strong>: " + esc(t.task))) +
    "<h4>Reviewers</h4>" + list(p.reviewTasks.map((t) => "<strong>" + esc(t.agent) + "</strong>: " + esc(t.task))) +
    "<h4>Acceptance</h4>" + list(p.acceptance.map(esc)) +
    "<h4>Depends on</h4><p>" + esc(p.dependsOn.join(", ") || "nothing") + "</p>";
}
for (const el of document.querySelectorAll(".phase")) {
  el.addEventListener("mouseenter", () => { if (!pinned) show(el.dataset.id); });
  el.addEventListener("click", () => {
    document.querySelectorAll(".phase.selected").forEach((s) => s.classList.remove("selected"));
    if (pinned === el.dataset.id) { pinned = null; return; }
    pinned = el.dataset.id;
    el.classList.add("selected");
    show(pinned);
    // Details right below the tapped wave, so a phone does not have to scroll to the end.
    el.closest(".wave").after(details);
  });
}
</script>
</body>
</html>
`;
}

// ---------- Command ----------

export function visualize(argv) {
  const positional = [];
  let root = process.cwd();
  let out = null;
  let runFile;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") root = resolve(argv[++i]);
    else if (argv[i] === "--out") out = argv[++i];
    else if (argv[i] === "--run") runFile = resolve(argv[++i]);
    else positional.push(argv[i]);
  }
  const [name] = positional;
  if (!name || !SLUG.test(name)) return { ok: false, usage: true, errors: ["Usage: node visualize.mjs <name> [--root <dir>] [--out <dir>] [--run <file>]"] };
  const model = buildModel(root, name, runFile);
  if (!model.phases) return { ok: false, errors: model.errors };
  const dir = out ? resolve(root, out) : join(root, "docs", "pipeline-status", name);
  mkdirSync(dir, { recursive: true });
  const generatedAt = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
  writeFileSync(join(dir, "README.md"), renderMarkdown(model, generatedAt));
  writeFileSync(join(dir, "pipeline.html"), renderHtml(model, generatedAt));
  return {
    ok: true,
    files: ["README.md", "pipeline.html"].map((f) => relative(root, join(dir, f))),
    states: Object.fromEntries(model.phases.map((p) => [p.id, p.state])),
    warnings: model.errors,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = visualize(process.argv.slice(2));
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.usage ? 2 : result.ok ? 0 : 1);
}
