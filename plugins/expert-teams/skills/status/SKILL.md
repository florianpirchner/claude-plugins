---
name: status
description: Shows the state of all pipelines in .claude/expert-teams/pipelines/ or of one pipeline, plus open drafts of /expert-teams:create and /expert-teams:modify, and writes a chart of each pipeline. Changes nothing else.
argument-hint: "[<name>]"
---

# State of the pipelines

You only read, except for the generated views in step 5.

**Plugin directory:** `${CLAUDE_PLUGIN_ROOT}`. If that literally reads `${CLAUDE_PLUGIN_ROOT}`, it is the directory two levels above this skill's directory. Below it is called `<plugin>`. All commands run in the root of the git repository.

Argument: `$ARGUMENTS`

1. List the pipelines: `node <plugin>/scripts/validate.mjs list`.
2. If the argument is empty, take all pipelines. Otherwise the argument must match one of them exactly. If not, list the existing ones and stop.
3. For every chosen pipeline: `node <plugin>/scripts/validate.mjs pipeline <name>` and read the phases from `.claude/expert-teams/pipelines/<name>.yaml`.
4. Print a table per pipeline: phase, status (`done`, `startable`, `waiting for …`), number of rounds and consult questions from the status file, and the human-in-the-loop level (the phase's `humanInTheLoop`, else `rules.humanInTheLoop`, else `as-needed`). Done is what is listed in `done`; it is read from the integration branch `target` (`statusFrom` in the output names the branch, or the working tree), even while another branch is checked out. Name `target` above the table. Startable is an open phase whose `dependsOn` are all done.
5. Write the view of every chosen pipeline:
   ```
   node <plugin>/scripts/visualize.mjs <name>
   ```
   It writes `docs/pipeline-status/<name>/README.md` (Mermaid chart top to bottom: phase, builders and state per box, reviewers in the list below; GitHub shows it when the folder is opened) and `docs/pipeline-status/<name>/pipeline.html` (one file without dependencies; hover or tap a phase for builders, reviewers, tasks, round and acceptance criteria). States: done, running with its round, waiting for you, startable, open; running and waiting come from `.claude/expert-teams/runs/<name>.yaml`. Name both files and say that the HTML file opens locally in a browser. Do not commit them; the run commits them with every delivered phase.
6. If the validation reports errors, list them below the table.
7. List open drafts in `.claude/expert-teams/drafts/` (stage other than `done`) with kind, stage and last change, and note that `/expert-teams:create` continues create drafts and `/expert-teams:modify <name>` continues modify drafts.
8. End with the fitting next command, e.g. `/<name>` or `/expert-teams:run <name> <phase-id>`.
