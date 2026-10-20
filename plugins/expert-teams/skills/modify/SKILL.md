---
name: modify
description: Guides the user in conversation through a change of an existing pipeline in .claude/expert-teams/pipelines/<name>.yaml, e.g. add or remove roles and phases, change pairs, order or rules. Same five stages and draft as /expert-teams:create, starting from the current pipeline. Survives restarts.
argument-hint: "<name>"
disable-model-invocation: true
model: opus
---

# Change a pipeline together

You guide the user through the same five stages as `/expert-teams:create`: **brainstorming → grill me → team → flow → generate**. The difference: you start from the existing pipeline and only change what the user wants changed. You propose, ask and record. The user decides when a stage is finished. You never move on to the next stage by yourself.

**Plugin directory:** `${CLAUDE_PLUGIN_ROOT}`. If that literally reads `${CLAUDE_PLUGIN_ROOT}`, it is the directory two levels above this skill's directory. Below it is called `<plugin>`.

**Project directory:** the root of the git repository (`git rev-parse --show-toplevel`), otherwise the current directory. All paths are relative to it.

Speak the user's language. Ask at most three questions at once and make a proposal for each that the user can simply confirm. The guidelines for roles and phases in `<plugin>/skills/create/SKILL.md` (stages 2 to 4) apply here too; read them.

## The draft: your memory

The state lives in `.claude/expert-teams/drafts/modify-<name>.yaml` with `kind: "modify"` and follows `<plugin>/schemas/setup.schema.json`. Only what is written there survives a restart.

- Rewrite the file **after every decision and every new insight**. Set `updatedAt` to the current time.
- Keep `changes` as the complete list of agreed changes against the current pipeline, one line each, e.g. `add phase load-test after backend` or `remove role ux-dataviz`.
- Validate after every write:
  ```
  node <plugin>/scripts/validate.mjs setup .claude/expert-teams/drafts/modify-<name>.yaml
  ```
  On `"ok": false` fix the file right away.

## Start

Argument: `$ARGUMENTS`

1. List the pipelines: `node <plugin>/scripts/validate.mjs list`. Do not guess a name from the argument.
   - If the argument is empty, show the list and ask which pipeline to change. If there is none, point to `/expert-teams:create` and stop.
   - If the argument is not exactly one of them, say so, show the list and stop.
   - Renaming a pipeline is not a change: suggest `/expert-teams:create` with the new name and stop.
2. If `.claude/expert-teams/drafts/modify-<name>.yaml` exists with `stage` other than `done`, summarize in three to five sentences where you stand and continue in its `stage`. If the pipeline file changed since `updatedAt` (`git log -1 --format=%cI -- .claude/expert-teams/pipelines/<name>.yaml`), say so and compare the draft with the current file before you continue.
3. Otherwise create the draft: `kind: "modify"`, `name: <name>`, `stage: "brainstorming"`, `changes: []`, `brainstorming.rules` = the current `rules`, `team.roles` = every agent the pipeline uses with `source: "existing"` and its `description` as `purpose`, `flow.phases` = the current `phases`.
4. Get the state:
   - `node <plugin>/scripts/validate.mjs pipeline <name>`. Show `errors` and `warnings`; fixing them can be part of the change. Remember `done`.
   - A run is in progress if `.claude/worktrees/<name>-*` exists or branches `pipeline/<name>/*` exist (`git branch --list 'pipeline/<name>/*'`). Then tell the user that running phases keep their old task until they are restarted, and recommend finishing or cancelling the run first.
5. Show the current pipeline briefly: goal, roles, phases as a table (phase, depends on, builders, reviewers, status) and the main rules.

## Stage 1: Brainstorming

Goal: understand what should change and why.

Open with a sentence like: "What should change in the pipeline, and why? Tell me when we have it. Then I look for open points and contradictions and grill you on them."

Clarify: the reason for the change, what should be different at the end, what must stay as it is, and whether rules change (delivery, `preCommit`, worktrees, `maxRounds`, models, `humanInTheLoop`, `askHumanWhen`, `consult`, `notes`). Models stay Opus unless the user explicitly wants something else.

Record `summary`, `openQuestions`, `rules` and `changes` in the draft. Only after the user confirms: `brainstorming.confirmed = true`, `stage = "grill-me"`.

## Stage 2: Grill me

Same as stage 2 of `/expert-teams:create`: analyse the draft against the current pipeline, its status files, `CLAUDE.md` and the inputs, record open points, contradictions and risks in `grillMe.findings`, and grill the user on them until none is `open`. Look especially for changes that contradict done phases, other pipelines that use the same agents, and rules that no longer fit. Only after confirmation: `grillMe.confirmed = true`, `stage = "team"`.

## Stage 3: Team

1. Start from `team.roles`. Propose additions, removals and changed purposes as a table: role, what for, change (`keep`, `add`, `remove`, `change`), source.
2. For a role to remove, list the phases it takes part in. They must get another builder or reviewer in stage 4, or go away.
3. Existing agent files are changed only with the user's consent. A changed agent file affects every pipeline that uses it: check `.claude/expert-teams/pipelines/*.yaml` and name the other pipelines.
4. Record every change in `team.roles` and `changes`. Only after confirmation: `team.confirmed = true`, `stage = "flow"`. If nothing changes in the team, the user can confirm this stage right away.

## Stage 4: Flow

1. Start from `flow.phases`. Propose the changed phases as a table: phase, change (`keep`, `add`, `remove`, `change`), goal, depends on, builders, reviewers, result files. Then show the new order as waves.
2. Watch the consequences:
   - **Done phases** (from `done`): changing them does not run them again. Ask per changed done phase whether it stays done or is reopened. Reopening means its status file `docs/pipeline-status/<name>/<phase-id>.yaml` is deleted in stage 5, so the next run builds it again on top of its earlier result.
   - **Removed phases:** every `dependsOn` that names them must be changed. Their status files are deleted in stage 5, otherwise validation fails. Their files in `docs/decisions/<name>/` stay as history.
   - **Renamed phase ids:** treat as remove plus add. A done phase keeps its state only if the status file is renamed along with it and its `phase` field is updated; ask the user.
   - **New phases** that depend on done phases are startable right away after the change.
3. Record the phases in `flow.phases` and every change in `changes`. Only after confirmation: `flow.confirmed = true`, `stage = "generate"`.

## Stage 5: Generate

1. **Show the differences** before you write anything: the list `changes`, the status files to delete or rename, the agent files to create or change. Write only after the user confirms.
2. **Agents.** Create new roles as `.claude/agents/<agent>.md` from `<plugin>/templates/agent.md`, `model: opus` unless the user set something else. Apply agreed changes to existing agent files. Removed roles: delete the agent file only if no other pipeline in `.claude/expert-teams/pipelines/` uses it and the user explicitly says yes; otherwise keep it.
3. **Pipeline.** Write `.claude/expert-teams/pipelines/<name>.yaml` with the new `description`, `inputs`, `rules` and `phases`, keeping `schemaVersion` and `name` and the existing comments that still apply. Add a short `#` comment wherever a choice is not obvious, e.g. why a phase has its own `humanInTheLoop` or why a rule exists. Delete or rename the agreed status files. Validate:
   ```
   node <plugin>/scripts/validate.mjs pipeline <name>
   ```
   Fix every error and validate again until `"ok": true`. Show the `warnings`.
4. **Skill.** If the description changed, update the `description` line in `.claude/skills/<name>/SKILL.md`. If the skill is missing, create it from `<plugin>/templates/pipeline-skill.md`.
5. **Wrap-up.** Set `stage = "done"` in the draft. Show what changed and which phases are open now, and the next command (`/<name> status` or `/<name>`). The files are not committed yet. Ask whether you should commit them. The delivery rule from `rules.delivery` or `CLAUDE.md` applies.

## Restart and cancel

- If the conversation is interrupted, nothing is lost as long as the draft is written. The next `/expert-teams:modify <name>` continues there.
- Until stage 5 writes, the pipeline itself stays untouched. If the user wants to go back to an earlier stage, set `stage` back and the `confirmed` fields from that stage on to `false`.
- If the user wants to cancel, ask whether the draft should be deleted. Delete it only on an explicit yes.
