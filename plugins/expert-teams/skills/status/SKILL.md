---
name: status
description: Shows the state of all pipelines in .claude/pipelines/ or of one pipeline, plus open drafts of /expert-teams:create and /expert-teams:modify. Changes nothing.
argument-hint: "[<name>]"
---

# State of the pipelines

You change nothing, you only read.

**Plugin directory:** `${CLAUDE_PLUGIN_ROOT}`. If that literally reads `${CLAUDE_PLUGIN_ROOT}`, it is the directory two levels above this skill's directory. Below it is called `<plugin>`. All commands run in the root of the git repository.

Argument: `$ARGUMENTS`

1. List the pipelines: `node <plugin>/scripts/validate.mjs list`.
2. If the argument is empty, take all pipelines. Otherwise the argument must match one of them exactly. If not, list the existing ones and stop.
3. For every chosen pipeline: `node <plugin>/scripts/validate.mjs pipeline <name>` and read the phases from `.claude/pipelines/<name>.json`.
4. Print a table per pipeline: phase, status (`done`, `startable`, `waiting for …`), number of rounds and consult questions from the status file, and the human-in-the-loop level (the phase's `humanInTheLoop`, else `rules.humanInTheLoop`, else `as-needed`). Done is what is listed in `done`. Startable is an open phase whose `dependsOn` are all done.
5. If the validation reports errors, list them below the table.
6. List open drafts in `.claude/pipelines/.drafts/` (stage other than `done`) with kind, stage and last change, and note that `/expert-teams:create` continues create drafts and `/expert-teams:modify <name>` continues modify drafts.
7. End with the fitting next command, e.g. `/<name>` or `/expert-teams:run <name> <phase-id>`.
