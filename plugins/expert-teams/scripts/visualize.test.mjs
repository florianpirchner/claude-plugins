// Tests for visualize.mjs. Run: node --test plugins/expert-teams/scripts/visualize.test.mjs
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { visualize } from "./visualize.mjs";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");
const NAME = "business-tool-mvp";

function project({ done = [], run } = {}) {
  const root = mkdtempSync(join(tmpdir(), "expert-teams-"));
  mkdirSync(join(root, ".claude", "expert-teams", "pipelines"), { recursive: true });
  writeFileSync(
    join(root, ".claude", "expert-teams", "pipelines", `${NAME}.yaml`),
    readFileSync(join(PLUGIN, "examples", `${NAME}.yaml`), "utf8"),
  );
  const statusDir = join(root, "docs", "pipeline-status", NAME);
  mkdirSync(statusDir, { recursive: true });
  for (const id of done) writeFileSync(join(statusDir, `${id}.yaml`), `pipeline: ${NAME}\nphase: ${id}\nstatus: done\nrounds: 2\n`);
  if (run) {
    mkdirSync(join(root, ".claude", "expert-teams", "runs"), { recursive: true });
    writeFileSync(join(root, ".claude", "expert-teams", "runs", `${NAME}.yaml`), run);
  }
  return root;
}

const RUN = [
  `pipeline: ${NAME}`,
  "phases:",
  "  calculation-forecast:",
  "    status: running",
  "    round: 2",
  "  billing-rules:",
  "    status: waiting-for-user",
  "    question: Bill travel time?",
].join("\n");

test("states come from status files and the run file", () => {
  const r = visualize([NAME, "--root", project({ done: ["requirements"], run: RUN })]);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.states.requirements, "done");
  assert.equal(r.states["calculation-forecast"], "running");
  assert.equal(r.states["billing-rules"], "waiting-for-user");
  assert.equal(r.states.views, "startable");
  assert.equal(r.states["data-model"], "open");
  assert.deepEqual(r.warnings, []);
});

test("README.md has a top-down Mermaid chart with builders, states and reviewers", () => {
  const root = project({ done: ["requirements"], run: RUN });
  const r = visualize([NAME, "--root", root]);
  assert.deepEqual(r.files, [`docs/pipeline-status/${NAME}/README.md`, `docs/pipeline-status/${NAME}/pipeline.html`]);
  const md = readFileSync(join(root, r.files[0]), "utf8");
  assert.ok(md.includes("```mermaid\nflowchart TD"));
  assert.ok(md.includes('p0["<b>requirements</b><br/>B: product-manager<br/>done, 2 rounds"]:::done'));
  assert.ok(md.includes("running, round 2\"]:::running"));
  assert.ok(md.includes("waiting for you\"]:::waiting"));
  assert.ok(md.includes("  p0 --> p1"));
  assert.ok(md.includes("- **billing-rules** (waiting for you): reviewers tester, controller. Question: Bill travel time?"));
  assert.ok(md.includes("State: 1 done, 1 running, 1 waiting for you, 2 startable, 6 open."));
});

test("pipeline.html is self-contained and carries the details", () => {
  const root = project();
  const r = visualize([NAME, "--root", root]);
  const html = readFileSync(join(root, r.files[1]), "utf8");
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(!/<script[^>]+src=|<link[^>]+href=/.test(html), "no external resources");
  assert.ok(html.includes("<h2>Wave 1</h2>"));
  assert.ok(html.includes("Every rule has at least one example with a result."));
});

test("text from the pipeline cannot break the chart or the page", () => {
  const root = project();
  const file = join(root, ".claude", "expert-teams", "pipelines", `${NAME}.yaml`);
  writeFileSync(file, readFileSync(file, "utf8").replace("Turn the MVP scope", 'Turn </script><b>"the" [MVP] scope'));
  const r = visualize([NAME, "--root", root]);
  const html = readFileSync(join(root, r.files[1]), "utf8");
  assert.equal(html.split("</script>").length, 2, "only the closing tag of the page script");
});

test("an invalid run file is reported and ignored", () => {
  const root = project({ run: `pipeline: ${NAME}\nphases:\n  views:\n    status: busy\n` });
  const r = visualize([NAME, "--root", root]);
  assert.equal(r.ok, true);
  assert.equal(r.states.views, "open");
  assert.ok(r.warnings.some((w) => w.includes("busy")));
});

test("--run reads the run file from another directory", () => {
  const worktree = project({ done: ["requirements"] });
  const elsewhere = mkdtempSync(join(tmpdir(), "expert-teams-"));
  writeFileSync(join(elsewhere, "run.yaml"), RUN);
  const r = visualize([NAME, "--root", worktree, "--run", join(elsewhere, "run.yaml")]);
  assert.equal(r.states["calculation-forecast"], "running");
});

test("--out and wrong names", () => {
  const root = project();
  const r = visualize([NAME, "--root", root, "--out", "views"]);
  assert.ok(existsSync(join(root, "views", "README.md")));
  assert.equal(r.ok, true);
  assert.equal(visualize(["unknown", "--root", root]).ok, false);
  assert.equal(visualize(["Bad_Name", "--root", root]).usage, true);
});
