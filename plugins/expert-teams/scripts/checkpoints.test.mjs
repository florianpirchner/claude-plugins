// Tests for "validate.mjs checkpoints" against real git repositories.
// Run: node --test plugins/expert-teams/scripts/checkpoints.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { run } from "./validate.mjs";
import { visualize } from "./visualize.mjs";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");
const NAME = "business-tool-mvp";
const STATUS = join("docs", "pipeline-status", NAME);

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function commitAll(cwd, message) {
  git(cwd, "add", "-A");
  git(cwd, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-q", "-m", message);
}

// A project with a bare remote; requirements is done on main.
function project() {
  const base = mkdtempSync(join(tmpdir(), "expert-teams-"));
  const remote = join(base, "remote.git");
  const root = join(base, "project");
  git(base, "init", "-q", "--bare", "-b", "main", remote);
  git(base, "clone", "-q", remote, root);
  git(root, "checkout", "-q", "-b", "main");
  mkdirSync(join(root, ".claude", "expert-teams", "pipelines"), { recursive: true });
  writeFileSync(join(root, ".claude", "expert-teams", "pipelines", `${NAME}.yaml`), readFileSync(join(PLUGIN, "examples", `${NAME}.yaml`), "utf8"));
  mkdirSync(join(root, STATUS), { recursive: true });
  writeFileSync(join(root, STATUS, "requirements.yaml"), `pipeline: ${NAME}\nphase: requirements\nstatus: done\nrounds: 1\n`);
  commitAll(root, "start");
  git(root, "push", "-q", "-u", "origin", "main");
  return root;
}

function checkpointBranch(root, id, content, { push = true } = {}) {
  git(root, "checkout", "-q", "-b", `pipeline/${NAME}/${id}`, "main");
  if (content) writeFileSync(join(root, STATUS, `${id}.yaml`), content);
  writeFileSync(join(root, `${id}.txt`), "work in progress\n");
  commitAll(root, `${id}: checkpoint`);
  if (push) git(root, "push", "-q", "-u", "origin", `pipeline/${NAME}/${id}`);
  git(root, "checkout", "-q", "main");
}

const checkpoints = (root) => run(["checkpoints", NAME, "--root", root]);

test("finds pushed checkpoints with round, step and findings", () => {
  const root = project();
  checkpointBranch(
    root,
    "calculation-forecast",
    [
      `pipeline: ${NAME}`,
      "phase: calculation-forecast",
      "status: in-progress",
      "round: 2",
      "step: review",
      "findings:",
      "  - by: tester",
      "    severity: blocking",
      "    text: Margin formula has no example",
    ].join("\n"),
  );
  const r = checkpoints(root);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.checkpoints.length, 1);
  const [c] = r.checkpoints;
  assert.equal(c.phase, "calculation-forecast");
  assert.equal(c.status, "in-progress");
  assert.equal(c.round, 2);
  assert.equal(c.step, "review");
  assert.equal(c.findings[0].severity, "blocking");
  assert.equal(c.pushed, true);
});

test("survives losing the local clone: a fresh clone sees the same checkpoint", () => {
  const root = project();
  checkpointBranch(root, "views", `pipeline: ${NAME}\nphase: views\nstatus: in-progress\nround: 1\nstep: build\n`);
  const fresh = join(dirname(root), "fresh");
  git(dirname(root), "clone", "-q", join(dirname(root), "remote.git"), fresh);
  const r = checkpoints(fresh);
  assert.equal(r.checkpoints[0].phase, "views");
  assert.equal(r.checkpoints[0].step, "build");
});

test("a newer local branch wins over the remote, a branch without checkpoint is reported", () => {
  const root = project();
  checkpointBranch(root, "views", `pipeline: ${NAME}\nphase: views\nstatus: in-progress\nround: 1\nstep: build\n`);
  git(root, "checkout", "-q", `pipeline/${NAME}/views`);
  writeFileSync(join(root, STATUS, "views.yaml"), `pipeline: ${NAME}\nphase: views\nstatus: in-progress\nround: 1\nstep: review\n`);
  commitAll(root, "views: review");
  git(root, "checkout", "-q", "main");
  checkpointBranch(root, "billing-rules", null, { push: false });
  const r = checkpoints(root);
  const byId = Object.fromEntries(r.checkpoints.map((c) => [c.id, c]));
  assert.equal(byId.views.step, "review");
  assert.equal(byId.views.pushed, false);
  assert.equal(byId["billing-rules"].status, "no-checkpoint");
});

test("phases done on main and branches of other pipelines are ignored", () => {
  const root = project();
  checkpointBranch(root, "requirements", `pipeline: ${NAME}\nphase: requirements\nstatus: in-progress\nround: 1\nstep: build\n`);
  git(root, "checkout", "-q", "-b", "pipeline/other/views", "main");
  git(root, "checkout", "-q", "main");
  assert.deepEqual(checkpoints(root).checkpoints, []);
});

test("an invalid checkpoint is an error", () => {
  const root = project();
  checkpointBranch(root, "views", `pipeline: ${NAME}\nphase: views\nstatus: halfway\n`);
  const r = checkpoints(root);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("halfway")));
});

test("status comes from the integration branch while main is checked out", () => {
  const root = project();
  git(root, "checkout", "-q", "-b", `expert-teams/${NAME}`, "main");
  writeFileSync(join(root, STATUS, "views.yaml"), `pipeline: ${NAME}\nphase: views\nstatus: done\nrounds: 1\n`);
  commitAll(root, "views done");
  git(root, "push", "-q", "-u", "origin", `expert-teams/${NAME}`);
  git(root, "checkout", "-q", "main");
  const r = run(["pipeline", NAME, "--root", root, "--agents-dir", join(PLUGIN, "domains", "software", "agents")]);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.target, `expert-teams/${NAME}`);
  assert.deepEqual(r.done.sort(), ["requirements", "views"]);
  assert.match(r.statusFrom, /expert-teams\/business-tool-mvp$/);
  // The view reads the same branch.
  const v = visualize([NAME, "--root", root]);
  assert.equal(v.states.views, "done");
  assert.ok(readFileSync(join(root, STATUS, "README.md"), "utf8").includes(`Phases are merged into \`expert-teams/${NAME}\``));
  // --working-tree reads only what is on disk (main).
  assert.equal(visualize([NAME, "--root", root, "--working-tree"]).states.views, "startable");
});

test("integrationBranch none reads main, the same name as baseBranch is an error", () => {
  const root = project();
  const file = join(root, ".claude", "expert-teams", "pipelines", `${NAME}.yaml`);
  const original = readFileSync(file, "utf8");
  writeFileSync(file, original.replace("  baseBranch: main\n", "  baseBranch: main\n  integrationBranch: none\n"));
  const r = run(["pipeline", NAME, "--root", root, "--agents-dir", join(PLUGIN, "domains", "software", "agents")]);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.target, "main");
  assert.equal(r.statusFrom, "working tree");
  writeFileSync(file, original.replace("  baseBranch: main\n", "  baseBranch: main\n  integrationBranch: main\n"));
  assert.equal(run(["pipeline", NAME, "--root", root, "--agents-dir", join(PLUGIN, "domains", "software", "agents")]).ok, false);
});
