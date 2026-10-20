// Tests for validate.mjs. Run: node --test plugins/expert-teams/scripts/validate.test.mjs
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { run } from "./validate.mjs";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLE = JSON.parse(readFileSync(join(PLUGIN, "examples", "business-tool-mvp.json"), "utf8"));
const AGENTS = join(PLUGIN, "examples", "agents");

function project(pipeline, name = pipeline.name) {
  const root = mkdtempSync(join(tmpdir(), "expert-teams-"));
  mkdirSync(join(root, ".claude", "expert-teams", "pipelines"), { recursive: true });
  writeFileSync(join(root, ".claude", "expert-teams", "pipelines", `${name}.json`), JSON.stringify(pipeline));
  return root;
}

const clone = () => structuredClone(EXAMPLE);
const check = (root, name = "business-tool-mvp") => run(["pipeline", name, "--root", root, "--agents-dir", AGENTS]);

test("the example is valid", () => {
  const r = check(project(clone()));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.warnings, []);
});

test("unknown field and wrong mode are detected", () => {
  const p = clone();
  p.phases[0].foo = 1;
  p.phases[0].participants[0].mode = "reviw";
  const r = check(project(p));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('unknown field "foo"')));
  assert.ok(r.errors.some((e) => e.includes('"reviw" is not allowed')));
});

test("unknown dependency and cycle are detected", () => {
  const p = clone();
  p.phases[1].dependsOn = ["requirement"];
  p.phases[0].dependsOn = ["acceptance"];
  const r = check(project(p));
  assert.ok(r.errors.some((e) => e.includes('unknown phase "requirement"')));
  assert.ok(r.errors.some((e) => e.startsWith("Cycle")));
});

test("missing agent file and missing reviewer are detected", () => {
  const p = clone();
  p.phases[0].participants = [{ agent: "does-not-exist", mode: "build", task: "x", outputs: ["a.md"] }];
  const r = check(project(p));
  assert.ok(r.errors.some((e) => e.includes('Agent "does-not-exist"')));
  assert.ok(r.errors.some((e) => e.includes("mode review")));
});

test("name and file name must match", () => {
  const r = check(project(clone(), "other-name"), "other-name");
  assert.ok(r.errors.some((e) => e.includes("the file is called other-name.json")));
});

test("status files are checked", () => {
  const root = project(clone());
  const dir = join(root, "docs", "pipeline-status", "business-tool-mvp");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "requirements.json"), JSON.stringify({ pipeline: "business-tool-mvp", phase: "requirements", status: "done", consults: { controller: 1, human: 1 } }));
  writeFileSync(join(dir, "views.json"), JSON.stringify({ pipeline: "business-tool-mvp", phase: "views", status: "finished" }));
  const r = check(root);
  assert.deepEqual(r.done, ["requirements"]);
  assert.ok(r.errors.some((e) => e.includes('"finished" is not allowed')));
});

test("human in the loop: invalid level is rejected, inconsistent settings warn", () => {
  const p = clone();
  p.rules.humanInTheLoop = "sometimes";
  assert.ok(check(project(p)).errors.some((e) => e.includes('"sometimes" is not allowed')));

  const q = clone();
  q.rules.humanInTheLoop = "as-needed";
  delete q.rules.askHumanWhen;
  assert.ok(check(project(q)).warnings.some((w) => w.includes("askHumanWhen is empty")));

  const s = clone();
  s.rules.humanInTheLoop = "autonomous";
  s.rules.askHumanWhen = ["prices"];
  assert.ok(check(project(s)).warnings.some((w) => w.includes("has no effect")));

  const t = clone();
  t.phases[0].humanInTheLoop = "always";
  assert.equal(check(project(t)).ok, true);
});

test("consultWith must name existing agents other than the role itself", () => {
  const p = clone();
  const builder = p.phases[0].participants.find((x) => x.mode === "build");
  builder.consultWith = [builder.agent, "nobody"];
  const r = check(project(p));
  assert.ok(r.errors.some((e) => e.includes("lists itself in consultWith")));
  assert.ok(r.errors.some((e) => e.includes('Agent "nobody"')));
});

test("args accepts only exact names, status or a phase, plus one human-in-the-loop flag", () => {
  const root = project(clone());
  const a = (...w) => run(["args", "--root", root, "--", ...w]);
  assert.deepEqual(a("business-tool-mvp"), { ok: true, name: "business-tool-mvp", mode: "all", phase: null, humanInTheLoop: null });
  assert.equal(a("business-tool-mvp", "status").mode, "status");
  assert.equal(a("business-tool-mvp", "views").phase, "views");
  assert.equal(a("business-tool-mvp", "--autonomous").humanInTheLoop, "autonomous");
  assert.equal(a("business-tool-mvp", "views", "--always").humanInTheLoop, "always");
  assert.equal(a("business-tool-mvp", "--sometimes").ok, false);
  assert.equal(a("business-tool-mvp", "--always", "--autonomous").ok, false);
  assert.equal(a().ok, false);
  assert.equal(a("what", "a", "nice", "day", "today.").ok, false);
  assert.equal(a("business-tool-mvp", "no-such-phase").ok, false);
  assert.deepEqual(a("x").pipelines, ["business-tool-mvp"]);
});

test("new-name checks format and collisions", () => {
  const root = project(clone());
  assert.equal(run(["new-name", "optimize-performance", "--root", root]).ok, true);
  assert.equal(run(["new-name", "Optimize_Performance", "--root", root]).ok, false);
  assert.equal(run(["new-name", "business-tool-mvp", "--root", root]).ok, false);
});

test("setup checks the draft", () => {
  const root = mkdtempSync(join(tmpdir(), "expert-teams-"));
  const file = join(root, "draft.json");
  const draft = {
    draft: "draft-1",
    name: null,
    stage: "team",
    updatedAt: "2026-10-19T19:00:00Z",
    brainstorming: { summary: "Goal", openQuestions: [] },
    team: { roles: [{ agent: "tester", purpose: "checks", source: "example" }] },
    flow: { phases: [] },
  };
  writeFileSync(file, JSON.stringify(draft));
  assert.equal(run(["setup", file]).ok, true);
  writeFileSync(file, JSON.stringify({ ...draft, stage: "finished" }));
  assert.equal(run(["setup", file]).ok, false);
});

test("setup checks the grill-me findings", () => {
  const root = mkdtempSync(join(tmpdir(), "expert-teams-"));
  const file = join(root, "draft.json");
  const draft = {
    draft: "draft-1",
    name: null,
    stage: "grill-me",
    updatedAt: "2026-10-20T08:30:00Z",
    brainstorming: { summary: "Goal", openQuestions: [], confirmed: true },
    grillMe: {
      findings: [
        { kind: "contradiction", question: "PR left open, but CLAUDE.md says merge right away?", status: "open" },
        { kind: "open", question: "What does finished mean?", answer: "All tests green", status: "settled" },
      ],
    },
    team: { roles: [] },
    flow: { phases: [] },
  };
  writeFileSync(file, JSON.stringify(draft));
  assert.equal(run(["setup", file]).ok, true);
  const bad = structuredClone(draft);
  bad.grillMe.findings[0].kind = "question";
  writeFileSync(file, JSON.stringify(bad));
  assert.equal(run(["setup", file]).ok, false);
});

test("setup checks a modify draft against the existing pipeline", () => {
  const root = project(clone());
  const file = join(root, "draft.json");
  const draft = {
    draft: "modify-business-tool-mvp",
    kind: "modify",
    name: "business-tool-mvp",
    changes: ["add phase load-test after backend"],
    stage: "flow",
    updatedAt: "2026-10-20T07:00:00Z",
    brainstorming: { summary: "Add a load test", openQuestions: [] },
    team: { roles: [] },
    flow: { phases: [] },
  };
  writeFileSync(file, JSON.stringify(draft));
  assert.equal(run(["setup", file, "--root", root]).ok, true);
  writeFileSync(file, JSON.stringify({ ...draft, name: "unknown-pipeline" }));
  assert.equal(run(["setup", file, "--root", root]).ok, false);
  writeFileSync(file, JSON.stringify({ ...draft, name: null }));
  assert.equal(run(["setup", file, "--root", root]).ok, false);
  writeFileSync(file, JSON.stringify({ ...draft, kind: "change" }));
  assert.equal(run(["setup", file, "--root", root]).ok, false);
});
