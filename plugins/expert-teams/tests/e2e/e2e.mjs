#!/usr/bin/env node
// End-to-end test of the expert-teams plugin: drives the real skills with a headless `claude -p` against a
// tiny todo API project and checks the result with the plugin's own scripts.
//
//   node tests/e2e/e2e.mjs [--stage all|create|run] [--dir <work-dir>] [--keep]
//
//   all     /expert-teams:create with the scripted answers in answers.md, then /expert-teams:run (default)
//   create  only the create conversation and its checks
//   run     only the run, starting from the pipeline in prebuilt/ (what create should produce)
//
// It costs real usage: one create conversation and a run of three phases with Opus agents.
// Needs git, Node.js 18 or later and a logged-in `claude` on PATH. Logs go to <work-dir>/logs/.
// Exit code 0 = every check passed.

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = resolve(HERE, "..", "..");
const NAME = "todo-api";
const PHASES = ["requirements", "implementation", "acceptance"];

const args = process.argv.slice(2);
const opt = (flag, fallback) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback);
const stage = opt("--stage", "all");
if (!["all", "create", "run"].includes(stage)) {
  console.error("Usage: node tests/e2e/e2e.mjs [--stage all|create|run] [--dir <work-dir>] [--keep]");
  process.exit(2);
}
const work = resolve(opt("--dir", mkdtempSync(join(tmpdir(), "expert-teams-e2e-"))));
const project = join(work, "project");
const remote = join(work, "origin.git");
const logs = join(work, "logs");
const checks = [];

function sh(cmd, argv, cwd = project) {
  return execFileSync(cmd, argv, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function tryGit(argv, cwd = project) {
  try {
    return sh("git", argv, cwd);
  } catch {
    return null;
  }
}
function check(label, ok, detail = "") {
  checks.push({ label, ok: !!ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `: ${detail}` : ""}`);
}
function script(name, argv) {
  const r = spawnSync("node", [join(PLUGIN, "scripts", name), ...argv, "--root", project], { encoding: "utf8" });
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { ok: false, errors: [r.stdout + r.stderr] };
  }
}

function setup() {
  rmSync(project, { recursive: true, force: true });
  rmSync(remote, { recursive: true, force: true });
  mkdirSync(logs, { recursive: true });
  cpSync(join(HERE, "fixture"), project, { recursive: true });
  if (stage === "run") cpSync(join(HERE, "prebuilt"), project, { recursive: true });
  writeFileSync(join(project, ".gitignore"), ".claude/worktrees/\n.claude/expert-teams/runs/\nnode_modules/\n");
  sh("git", ["init", "-q", "--bare", "-b", "main", remote], work);
  sh("git", ["init", "-q", "-b", "main"]);
  sh("git", ["config", "user.name", "expert-teams e2e"]);
  sh("git", ["config", "user.email", "e2e@example.invalid"]);
  sh("git", ["add", "-A"]);
  sh("git", ["commit", "-q", "-m", "Test project"]);
  sh("git", ["remote", "add", "origin", remote]);
  sh("git", ["push", "-q", "-u", "origin", "main"]);
}

// One headless Claude Code session running a skill; the harness prompt replaces the human.
function claude(label, prompt) {
  const harness = readFileSync(join(HERE, "harness.md"), "utf8")
    .replaceAll("{{ANSWERS}}", join(HERE, "answers.md"))
    .replaceAll("{{PROJECT}}", project);
  const started = Date.now();
  const r = spawnSync(
    "claude",
    [
      "-p", prompt,
      "--plugin-dir", PLUGIN,
      "--append-system-prompt", harness,
      "--disallowed-tools", "AskUserQuestion",
      "--dangerously-skip-permissions",
      "--output-format", "stream-json",
      "--verbose",
    ],
    { cwd: project, encoding: "utf8", maxBuffer: 1 << 30, timeout: 3 * 60 * 60 * 1000 },
  );
  writeFileSync(join(logs, `${label}.jsonl`), r.stdout ?? "");
  writeFileSync(join(logs, `${label}.stderr.txt`), r.stderr ?? "");
  const lines = (r.stdout ?? "").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
  const result = lines.findLast((l) => l.type === "result") ?? {};
  const text = result.result ?? "";
  const minutes = ((Date.now() - started) / 60000).toFixed(1);
  check(`${label}: session finished`, r.status === 0 && !result.is_error, `exit ${r.status}, ${minutes} min, ${result.num_turns ?? "?"} turns`);
  check(`${label}: skill reports done`, /E2E-RESULT: done/.test(text), (text.match(/E2E-RESULT:.*/) ?? ["no E2E-RESULT line"])[0]);
  return result;
}

function checkCreate() {
  const v = script("validate.mjs", ["pipeline", NAME]);
  check("create: pipeline file is valid", v.ok, (v.errors ?? []).join("; "));
  check("create: the three scripted phases", JSON.stringify(v.phases) === JSON.stringify(PHASES), JSON.stringify(v.phases));
  check("create: domain pack software chosen", JSON.stringify(v.domains) === JSON.stringify(["software"]) && !(v.warnings ?? []).some((w) => w.startsWith("domains")), JSON.stringify(v.domains));
  for (const agent of ["product-manager", "backend-developer", "tester"]) {
    check(`create: agent ${agent}`, existsSync(join(project, ".claude", "agents", `${agent}.md`)));
  }
  check("create: shortcut skill", existsSync(join(project, ".claude", "skills", NAME, "SKILL.md")));
  check("create: tech stack written", existsSync(join(project, "docs", "input", "tech-stack.md")));
  check("create: draft finished", readdirSync(join(project, ".claude", "expert-teams", "drafts")).some((f) =>
    /stage: "?done"?/.test(readFileSync(join(project, ".claude", "expert-teams", "drafts", f), "utf8"))));
  check("create: product vision untouched", tryGit(["diff", "--quiet", "HEAD~0", "--", "docs/input/product-vision.md"]) !== null);
  if (tryGit(["status", "--porcelain"])) {
    // The answers say to commit; commit what is left so the run starts from a clean tree.
    sh("git", ["add", "-A"]);
    sh("git", ["commit", "-q", "-m", "Pipeline todo-api (left uncommitted by create)"]);
    check("create: committed its files", false, "had to commit leftovers");
  } else check("create: committed its files", true);
  tryGit(["push", "-q", "origin", "main"]);
}

function checkRun() {
  const target = `expert-teams/${NAME}`;
  tryGit(["fetch", "-q", "origin"]);
  const v = script("validate.mjs", ["pipeline", NAME]);
  check("run: status files valid", v.ok, (v.errors ?? []).join("; "));
  check("run: all phases done on the integration branch", JSON.stringify([...(v.done ?? [])].sort()) === JSON.stringify([...PHASES].sort()), `done: ${JSON.stringify(v.done)} from ${v.statusFrom}`);
  check("run: integration branch pushed", tryGit(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${target}`]) !== null);
  check("run: main has no phase results", tryGit(["cat-file", "-e", "origin/main:src/server.js"]) === null);
  const checkout = join(work, "integration");
  rmSync(checkout, { recursive: true, force: true });
  tryGit(["worktree", "prune"]);
  const added = tryGit(["worktree", "add", "-q", "--detach", checkout, `origin/${target}`]);
  if (added !== null) {
    for (const f of ["docs/specification/requirements.md", "src/server.js", "test/server.test.js", "docs/acceptance/acceptance.md", `docs/pipeline-status/${NAME}/README.md`]) {
      check(`run: ${f}`, existsSync(join(checkout, f)));
    }
    const t = spawnSync("npm", ["test"], { cwd: checkout, encoding: "utf8" });
    writeFileSync(join(logs, "npm-test.txt"), t.stdout + t.stderr);
    check("run: npm test passes on the integration branch", t.status === 0);
    check("run: product vision untouched", tryGit(["diff", "--quiet", "origin/main", `origin/${target}`, "--", "docs/input/"]) !== null);
    tryGit(["worktree", "remove", "--force", checkout]);
  } else check("run: integration branch can be checked out", false);
  check("run: no run file left", !existsSync(join(project, ".claude", "expert-teams", "runs", `${NAME}.yaml`)));
  const worktrees = join(project, ".claude", "worktrees");
  check("run: no phase worktrees left", !existsSync(worktrees) || readdirSync(worktrees).length === 0);
}

setup();
console.log(`Work directory: ${work}`);
if (stage !== "run") {
  claude("create", `/expert-teams:create ${NAME}`);
  checkCreate();
}
if (stage !== "create") {
  claude("run", `/expert-teams:run ${NAME}`);
  checkRun();
}
const failed = checks.filter((c) => !c.ok);
writeFileSync(join(logs, "result.json"), JSON.stringify({ stage, work, checks }, null, 2));
console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed. Logs: ${logs}`);
if (!args.includes("--keep") && !failed.length && !opt("--dir")) rmSync(work, { recursive: true, force: true });
process.exit(failed.length ? 1 : 0);
