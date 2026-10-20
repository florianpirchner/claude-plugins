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

// A project as the fp plugin left it: JSON pipeline, JSON status files, old skill, German decision folder.
function oldProject({ done = ["requirements"] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "expert-teams-migrate-"));
  const pipeline = load(readFileSync(join(PLUGIN, "examples", `${NAME}.yaml`), "utf8"), { schema: JSON_SCHEMA });
  delete pipeline.rules.language;
  delete pipeline.rules.integrationBranch;
  write(root, `.claude/pipelines/${NAME}.json`, pipeline);
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
  assert.ok(readFileSync(join(root, `.claude/skills/${NAME}/SKILL.md`), "utf8").includes(`.claude/expert-teams/pipelines/${NAME}.yaml`));

  const v = validate(["pipeline", NAME, "--root", root, "--agents-dir", join(PLUGIN, "examples", "agents")]);
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
