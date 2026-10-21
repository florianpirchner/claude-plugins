// Tests for migrate.mjs. Run: node --test plugins/expert-teams/scripts/migrate.test.mjs
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { migrate } from "./migrate.mjs";
import { run as validate } from "./validate.mjs";
import { JSON_SCHEMA, load } from "./vendor/js-yaml.mjs";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");
const NAME = "business-tool-mvp";

function write(root, path, content) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), typeof content === "string" ? content : JSON.stringify(content, null, 2));
}

// The phases as expert-teams up to 0.14.0 wrote them: one participants list with modes, consultWith per role.
function toVersion1(pipeline) {
  pipeline.schemaVersion = 1;
  pipeline.phases = pipeline.phases.map(({ builder, reviewers, consultants, ...rest }) => {
    if (!builder) return rest;
    const consultWith = consultants?.map((c) => c.agent);
    const parts = [{ agent: builder.agent, mode: "build", ...builder, ...(consultWith ? { consultWith } : {}) }, ...reviewers.map((r) => ({ agent: r.agent, mode: "review", ...r }))];
    const out = {};
    for (const [k, v] of Object.entries(rest)) {
      if (k === "acceptance") out.participants = parts;
      out[k] = v;
    }
    return out;
  });
  return pipeline;
}

// A project as the fp plugin left it: JSON pipeline, JSON status files, old skill, German decision folder.
function oldProject({ done = ["requirements"] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "expert-teams-migrate-"));
  const pipeline = load(readFileSync(join(PLUGIN, "examples", `${NAME}.yaml`), "utf8"), { schema: JSON_SCHEMA });
  delete pipeline.rules.language;
  delete pipeline.rules.integrationBranch;
  delete pipeline.domains;
  write(root, `.claude/pipelines/${NAME}.json`, toVersion1(pipeline));
  for (const id of done) write(root, `docs/pipeline-status/${NAME}/${id}.json`, { pipeline: NAME, phase: id, status: "done", rounds: 2 });
  write(root, `.claude/pipelines/.drafts/new-pipeline.json`, { kind: "create", stage: "team" });
  write(root, `docs/entscheidungen/${NAME}/requirements.md`, "# requirements\n");
  write(root, `.claude/skills/${NAME}/SKILL.md`, `the pipeline lives in \`.claude/pipelines/${NAME}.json\`, the procedure ...\n`);
  return root;
}

test("the plan writes nothing and asks for the language", () => {
  const root = oldProject();
  const r = migrate(["--root", root]);
  assert.equal(r.applied, false);
  assert.deepEqual(r.decisions.map((d) => d.rule), ["language"]);
  assert.ok(existsSync(join(root, `.claude/pipelines/${NAME}.json`)));
  assert.ok(r.pipelineYaml[`.claude/expert-teams/pipelines/${NAME}.yaml`].includes("integrationBranch: none"));
  assert.deepEqual(
    r.steps.map((s) => `${s.op} ${s.from} -> ${s.to}`),
    [
      `convert .claude/pipelines/${NAME}.json -> .claude/expert-teams/pipelines/${NAME}.yaml`,
      `convert docs/pipeline-status/${NAME}/requirements.json -> docs/pipeline-status/${NAME}/requirements.yaml`,
      `move docs/entscheidungen/${NAME}/requirements.md -> docs/decisions/${NAME}/requirements.md`,
      `edit .claude/skills/${NAME}/SKILL.md -> .claude/skills/${NAME}/SKILL.md`,
      `convert .claude/pipelines/.drafts/new-pipeline.json -> .claude/expert-teams/drafts/new-pipeline.yaml`,
    ],
  );
});

test("--apply without a language decision changes nothing", () => {
  const root = oldProject();
  const r = migrate(["--root", root, "--apply"]);
  assert.equal(r.ok, false);
  assert.equal(r.applied, false);
  assert.ok(existsSync(join(root, `.claude/pipelines/${NAME}.json`)));
});

test("--apply converts everything, the result validates, a second run has nothing to do", () => {
  const root = oldProject();
  const r = migrate(["--root", root, "--apply", "--language", "de"]);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.applied, true);
  assert.ok(!existsSync(join(root, ".claude", "pipelines")), "old folder removed when empty");
  assert.ok(!existsSync(join(root, "docs", "entscheidungen")));
  assert.ok(existsSync(join(root, `docs/decisions/${NAME}/requirements.md`)));
  const yaml = readFileSync(join(root, `.claude/expert-teams/pipelines/${NAME}.yaml`), "utf8");
  assert.ok(yaml.startsWith("# Pipeline business-tool-mvp"));
  assert.ok(yaml.includes("  # Added by the migration: the language"));
  assert.ok(yaml.includes("  language:\n    code: de\n    docs: de\n    ui: de"));
  assert.ok(yaml.includes("# Added by the migration: domain packs"));
  assert.ok(yaml.indexOf("domains:\n  - software") < yaml.indexOf("\ninputs:"), "domains before inputs");
  assert.ok(readFileSync(join(root, `.claude/skills/${NAME}/SKILL.md`), "utf8").includes(`.claude/expert-teams/pipelines/${NAME}.yaml`));

  const v = validate(["pipeline", NAME, "--root", root, "--agents-dir", join(PLUGIN, "domains", "software", "agents")]);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.deepEqual(v.done, ["requirements"]);
  assert.equal(v.target, "main", "phases already on main keep going there");

  const again = migrate(["--root", root, "--apply", "--language", "de"]);
  assert.equal(again.nothingToDo, true);
  assert.equal(again.ok, true);
});

test("a pipeline without finished phases gets the integration branch default", () => {
  const root = oldProject({ done: [] });
  const r = migrate(["--root", root, "--apply", "--language", "en,de,de"]);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const p = load(readFileSync(join(root, `.claude/expert-teams/pipelines/${NAME}.yaml`), "utf8"), { schema: JSON_SCHEMA });
  assert.equal(p.rules.integrationBranch, undefined);
  assert.deepEqual(p.rules.language, { code: "en", docs: "de", ui: "de" });
});

test("conflicts and bad arguments are reported, not overwritten", () => {
  const root = oldProject();
  write(root, `.claude/expert-teams/pipelines/${NAME}.yaml`, "name: other\n");
  const r = migrate(["--root", root, "--apply", "--language", "de"]);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("already exists")));
  assert.equal(readFileSync(join(root, `.claude/expert-teams/pipelines/${NAME}.yaml`), "utf8"), "name: other\n");
  assert.equal(migrate(["--root", root, "--language", "german"]).usage, true);
  assert.equal(migrate(["--bogus"]).usage, true);
});

test("a YAML pipeline without domains gets domains: [software], keeping its comments", () => {
  const root = mkdtempSync(join(tmpdir(), "expert-teams-migrate-"));
  const original = readFileSync(join(PLUGIN, "examples", `${NAME}.yaml`), "utf8").replace(/# Domain packs[^\n]*\ndomains:\n  - software\n/, "");
  assert.ok(!original.includes("domains:"));
  write(root, `.claude/expert-teams/pipelines/${NAME}.yaml`, original);
  const plan = migrate(["--root", root]);
  assert.deepEqual(plan.steps.map((s) => `${s.op} ${s.from}`), [`edit .claude/expert-teams/pipelines/${NAME}.yaml`]);
  assert.deepEqual(plan.decisions, []);

  const r = migrate(["--root", root, "--apply"]);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const yaml = readFileSync(join(root, `.claude/expert-teams/pipelines/${NAME}.yaml`), "utf8");
  assert.ok(yaml.startsWith("# Example pipeline"), "header stays on top");
  assert.ok(yaml.includes("# Added by the migration: domain packs"));
  assert.equal(yaml.replace(/# Added by the migration: domain packs[^\n]*\ndomains:\n  - software\n/, ""), original, "nothing else changed");
  const v = validate(["pipeline", NAME, "--root", root, "--agents-dir", join(PLUGIN, "domains", "software", "agents")]);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.deepEqual(v.warnings, []);
  assert.equal(migrate(["--root", root, "--apply"]).nothingToDo, true);
});

// A version 1 YAML pipeline with comments, a role in two modes and a phase with two builders.
const V1 = `# Pipeline v1 of the expert-teams plugin.
schemaVersion: 1
name: v1
description: Old layout.
domains:
  - software
rules:
  maxRounds: 2
  delivery: commit
  baseBranch: main
  askHumanWhen:
    - Prices
phases:
  - id: requirements
    goal: Requirements.
    dependsOn: []
    # The product manager writes, the tester checks.
    participants:
      - agent: product-manager
        mode: build
        task: Write them.
        outputs:
          - docs/requirements.md
        consultWith:
          - controller
      # A comment inside the list.
      - agent: tester
        mode: review
        task: Check them.
        consultWith:
          - product-manager
    acceptance:
      - Testable.
  - id: concept
    goal: Concepts.
    dependsOn:
      - requirements
    participants:
      - agent: software-architect
        mode: build
        task: Architecture.
        outputs:
          - docs/architecture.md
      - agent: ux-dataviz
        mode: build
        task: Views.
        outputs:
          - docs/views.md
      - agent: tester
        mode: review
        task: Check both.
    acceptance:
      - Complete.
  - id: build
    goal: Build.
    dependsOn:
      - concept
    participants:
      - agent: backend-developer
        mode: build
        task: Code.
        outputs:
          - src/
      - agent: backend-developer
        mode: review
        task: Self check.
      - agent: tester
        mode: review
        task: Tests.
    acceptance:
      - Green.
`;

function v1Project(done = []) {
  const root = mkdtempSync(join(tmpdir(), "expert-teams-migrate-"));
  write(root, ".claude/expert-teams/pipelines/v1.yaml", V1);
  for (const id of done) write(root, `docs/pipeline-status/v1/${id}.yaml`, `pipeline: v1\nphase: ${id}\nstatus: done\n`);
  return root;
}

const validateV1 = (root) => validate(["pipeline", "v1", "--root", root, "--agents-dir", join(PLUGIN, "domains", "software", "agents")]);

test("schemaVersion 1 without a split: builder, reviewers and consultants in place, comments kept", () => {
  const root = v1Project(["concept"]);
  const r = migrate(["--root", root, "--apply"]);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.steps.map((s) => s.added), [["builder", "reviewers", "consultants"]]);
  assert.ok(r.notes.some((n) => n.includes("v1/concept had 2 builders and is done, so it is not split")));
  assert.ok(r.notes.some((n) => n.includes('"backend-developer" was builder and reviewer')));
  const yaml = readFileSync(join(root, ".claude/expert-teams/pipelines/v1.yaml"), "utf8");
  assert.ok(yaml.startsWith("# Pipeline v1 of the expert-teams plugin.\nschemaVersion: 2\n"));
  assert.ok(yaml.includes("    # The product manager writes, the tester checks.\n    builder:\n      agent: product-manager\n"));
  assert.ok(!yaml.includes("participants") && !yaml.includes("mode:") && !yaml.includes("consultWith"));
  const p = load(yaml, { schema: JSON_SCHEMA });
  assert.deepEqual(p.phases[0].consultants, [{ agent: "controller" }]);
  assert.deepEqual(p.phases[1].builder.agent, "software-architect");
  assert.deepEqual(p.phases[2].reviewers.map((x) => x.agent), ["tester"]);
  assert.deepEqual(p.phases.map((x) => x.id), ["requirements", "concept", "build"]);
  const v = validateV1(root);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal(migrate(["--root", root]).nothingToDo, true);
});

test("a JSON status file next to a YAML pipeline becomes YAML", () => {
  const root = v1Project(["requirements"]);
  migrate(["--root", root, "--apply"]);
  write(root, "docs/pipeline-status/v1/concept.json", { pipeline: "v1", phase: "concept", status: "done", rounds: 1 });
  const r = migrate(["--root", root, "--apply"]);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.steps.map((s) => `${s.op} ${s.from}`), ["convert docs/pipeline-status/v1/concept.json"]);
  assert.deepEqual(validateV1(root).done, ["concept", "requirements"]);
});

test("schemaVersion 1: a phase with two builders that is not done is split", () => {
  const root = v1Project();
  const r = migrate(["--root", root, "--apply"]);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.ok(r.notes.some((n) => n.includes("v1/concept had 2 builders and is split: software-architect keeps concept, ux-dataviz builds concept-ux-dataviz")));
  const yaml = readFileSync(join(root, ".claude/expert-teams/pipelines/v1.yaml"), "utf8");
  assert.ok(yaml.startsWith("# Pipeline v1 of the expert-teams plugin.\n"), "header kept");
  assert.ok(yaml.includes("  # Split from concept by the migration: one builder per phase.\n  - id: concept-ux-dataviz\n"));
  const p = load(yaml, { schema: JSON_SCHEMA });
  assert.deepEqual(p.phases.map((x) => x.id), ["requirements", "concept", "concept-ux-dataviz", "build"]);
  const split = p.phases[2];
  assert.equal(split.builder.agent, "ux-dataviz");
  assert.deepEqual(split.builder.outputs, ["docs/views.md"]);
  assert.deepEqual(split.dependsOn, ["requirements"]);
  assert.deepEqual(split.reviewers.map((x) => x.agent), ["tester"]);
  assert.deepEqual(p.phases[3].dependsOn, ["concept", "concept-ux-dataviz"]);
  const v = validateV1(root);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});

test("schemaVersion 1 in a JSON pipeline is converted too", () => {
  const root = oldProject();
  const r = migrate(["--root", root, "--apply", "--language", "de"]);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const p = load(readFileSync(join(root, `.claude/expert-teams/pipelines/${NAME}.yaml`), "utf8"), { schema: JSON_SCHEMA });
  const expected = load(readFileSync(join(PLUGIN, "examples", `${NAME}.yaml`), "utf8"), { schema: JSON_SCHEMA });
  assert.equal(p.schemaVersion, 2);
  for (const [i, phase] of p.phases.entries()) {
    assert.deepEqual(phase.builder, expected.phases[i].builder);
    assert.deepEqual(phase.reviewers, expected.phases[i].reviewers);
    assert.deepEqual(phase.consultants, expected.phases[i].consultants?.map(({ agent }) => ({ agent })));
  }
});
