---
name: migrate
description: Brings pipelines of older versions of the plugin (JSON files in .claude/pipelines/, JSON status files, docs/entscheidungen/<name>/) into the current layout and YAML, adds domains: [software] to pipelines that have no domain packs yet, and converts schemaVersion 1 phases (participants list) to one builder, reviewers and consultants. Shows the plan first and changes nothing before the user confirms. Only on explicit invocation.
disable-model-invocation: true
---

# Migrate old pipelines

**Plugin directory:** `${CLAUDE_PLUGIN_ROOT}`. If that literally reads `${CLAUDE_PLUGIN_ROOT}`, it is the directory two levels above this skill's directory. Below it is called `<plugin>`. All commands run in the root of the git repository.

The script does the work; you only show, ask and commit. Do not move or edit the files yourself.

1. **Before you start.** Run `git status --porcelain`. If there are uncommitted changes, list them and stop: the user commits or stashes them first. If `.claude/expert-teams/runs/` holds a run file, a run is active: say so and stop, the migration waits until it is finished or stopped.
2. **Plan.**
   ```
   node <plugin>/scripts/migrate.mjs
   ```
   - `nothingToDo: true`: say that everything is current and stop.
   - `errors`: show them and stop. They name the file to fix by hand (usually a file that exists in the old and the new place).
   - Otherwise show the plan: every step from `steps` as one line (`convert`, `move` or `edit`, from, to), the new pipeline file from `pipelineYaml` in a fenced `yaml` block, the `added` rules with their comments, and the `notes`. `domains` in `added` means the pipeline gets `domains: [software]`, the only field of work of earlier versions; if the pipeline is about something else (e.g. marketing), say that the user can change it afterwards with `/expert-teams:modify <name>`. `builder`, `reviewers`, `consultants` in `added` means the phases move from the old `participants` list to one builder, reviewers and consultants (the `consultWith` lists of the phase become its consultants). Show every note about a phase with several builders prominently: an open phase is split into `<id>` and `<id>-<agent>` with the same goal, reviewers and acceptance; a done phase keeps its first builder. Offer to adjust the split phases' tasks and acceptance criteria afterwards with `/expert-teams:modify <name>`.
3. **Decisions.** For every entry in `decisions` ask the user, in one message together with the confirmation of the plan:
   - `language`: in which language the existing project is written: code (identifiers, tables, commits), documents, user interface. Propose what you see in the project (look at a few source files and documents). Explain that new projects default to English, and that switching an existing project to English means its existing text would be reworked phase by phase.
   Ask: apply the plan with these answers?
4. **Apply.** Only after the user confirmed:
   ```
   node <plugin>/scripts/migrate.mjs --apply --language <code>[,<docs>,<ui>]
   ```
   Leave out `--language` if `decisions` was empty.
   On `"ok": false` show the errors and stop. Then check the result: `node <plugin>/scripts/validate.mjs pipeline <name>` for every migrated pipeline must report `"ok": true` and the same phases as done as before.
5. **Commit.** Show `git status --short`. Commit everything in one commit `Migrate pipelines to expert-teams <version>` (version from `<plugin>/.claude-plugin/plugin.json`) and follow the project's `CLAUDE.md` for how changes reach the main branch (for example a pull request). Branches of unfinished phases (`pipeline/<name>/<phase-id>`) still hold the old JSON files: say that such a phase should be finished with the old plugin version first, or restarted.
6. End with the next command, e.g. `/expert-teams:status <name>`.
