---
name: run
description: Runs a builder/challenger pipeline from .claude/pipelines/<name>.json. Starts the agents phase by phase, has results reviewed and revised, settles consult questions and delivers every finished phase. Use only when the user asks for it explicitly or a pipeline skill invokes it.
argument-hint: "<name> [status | <phase-id>] [--autonomous | --as-needed | --always]"
model: opus
---

# Pipeline runner

You are the orchestrator. You do not write domain content or product code yourself; the agents do. You start them, give them their tasks, collect their results, settle their consult questions, decide stalemates and deliver. You only turn to the user where the human-in-the-loop level (section 5) says so.

**Plugin directory:** `${CLAUDE_PLUGIN_ROOT}`. If that literally reads `${CLAUDE_PLUGIN_ROOT}`, it is the directory two levels above this skill's directory. Below it is called `<plugin>`. The validation script is `<plugin>/scripts/validate.mjs`.

**Project directory:** the root of the git repository you work in (`git rev-parse --show-toplevel`). All commands run there, all paths are relative to it.

## 0. Check the argument

Argument: `$ARGUMENTS`

Do not guess anything from the argument. Split it at spaces into words and pass each word separately in single quotes:
```
node <plugin>/scripts/validate.mjs args -- '<word1>' '<word2>' ...
```
- `"ok": false`: Start nothing. Show the error, the existing pipelines (`pipelines`) or phases (`phases`) and the correct call `/expert-teams:run <name> [status | <phase-id>] [--autonomous | --as-needed | --always]`. Stop.
- `"ok": true`: Remember `name`, `mode`, `phase` and `humanInTheLoop`.
  - `mode: all`: run all open phases to the end
  - `mode: status`: only show the state (steps 1 and 2), start nothing
  - `mode: phase`: run only this one phase, provided its dependencies are done
  - `humanInTheLoop`: a level given for this run, or `null`

Below, `<name>` is the checked name and `P` is the file `.claude/pipelines/<name>.json`.

## 1. Determine the state

1. Read `P` and its `rules.baseBranch` (below `<base>`). Run `git checkout <base> && git pull` in the project directory if a remote exists.
2. Validate the pipeline:
   ```
   node <plugin>/scripts/validate.mjs pipeline <name>
   ```
   On `"ok": false` start nothing, show all `errors` and stop. Do not repair the file yourself. Show `warnings` once and continue.
3. Read the project's `CLAUDE.md` if there is one. Its rules apply in addition to `rules`.
4. A phase is `done` if it is listed in `done` of the validation output, i.e. `docs/pipeline-status/<name>/<phase-id>.json` exists on `<base>` with `"status": "done"`. Everything else is open.
5. An open phase is **startable** if every phase in its `dependsOn` is `done`.

## 2. Sync the task list

Create a task for every phase that does not have one yet (`TaskList`, then `TaskCreate` with the subject `<name>/<phase-id>: <goal>`). Set `addBlockedBy` for every dependency. Mark done phases `completed`. With `mode: status`, then print a table of phase, status, waiting for, and the effective human-in-the-loop level per phase, and stop.

## 3. Start a wave

With `mode: all`, all startable phases are started; with `mode: phase`, only the named one. If it is not startable, name the open dependencies and stop.

**With `rules.worktrees: true`** all startable phases form a wave and run in parallel, with at most `rules.maxParallelAgents` (default 4) agents at a time. For each phase:
```
git fetch origin <base>
git worktree add .claude/worktrees/<name>-<phase-id> -b pipeline/<name>/<phase-id> origin/<base>
```
Without a remote use `<base>` instead of `origin/<base>`. If the worktree already exists (interrupted run), continue in it.

**With `rules.worktrees: false`** only one phase runs at a time, in the project directory on the branch `pipeline/<name>/<phase-id>` (create it or, after an interruption, reuse it).

The working directory of a phase is called `<wd>` below. Set the tasks of the started phases to `in_progress`.

## 4. Rounds of a phase

Repeat until accepted, at most `rules.maxRounds` times:

**Choose the model.** For every agent call: the phase's `models[mode]`, else `rules.models[mode]`, else `opus`. `sonnet` and `haiku` apply only if they are explicitly in the JSON. Pass the model to the Agent tool as `model`.

**Remember agent ids.** The Agent tool result contains an agent id. Note it per role and round: you need it to resume the role after a consult question (section 5).

**a) Build or revise.** Start every role with `mode: build` via the Agent tool (`subagent_type` = value of `agent`, `model` = build model) with this task:

```
Working directory: <absolute path of wd>. Read and write only there; all paths are relative to it.
This is a build task.

Phase goal: <goal>
Your task: <task>
Focus: <focus>
Inputs (read): <inputs of the pipeline and the phase>
To create: <outputs>
Acceptance criteria of the phase: <acceptance>

Rules: Do not change anything under <rules.readOnly>. Write open questions at the end of your document.
<every line of rules.notes>
[code phase and rules.preCommit set:] Run <rules.preCommit> before every commit. Commit only when it succeeds. Do not disable or skip the check.
<consult block, see section 5>
[from round 2:] Findings of the last review: <all findings>. Fix all blocking and important findings. Briefly explain which ones you do not adopt.
```

**b) Review.** Then start every role with `mode: review` (`model` = review model), all in parallel:

```
Working directory: <absolute path of wd>. Read only there.
This is a review task. Do not change any files.

Phase goal: <goal>
Your review task: <task>
Focus: <focus>
To review: <outputs of the phase>
Background (read): <inputs of the pipeline and the phase>
Acceptance criteria of the phase: <acceptance>
<every line of rules.notes>
<consult block, see section 5>

Report findings with severity (blocking / important / note) and end with exactly one line: "Overall verdict: accepted" or "Overall verdict: not accepted".
```

A role whose reply ends with a `CONSULT` block has not finished yet. Handle it as in section 5 and only evaluate its result once it has finished.

**c) Evaluate.** The phase is accepted when every review role reports "accepted" and no blocking finding is open. Otherwise start the next round with all findings.

**d) Stalemate.** If something is still open after `maxRounds`, every open finding gets decided: adopt it (then one last build round just for that, without another review) or discard it. Who decides follows the phase's human-in-the-loop level (section 5): `always` puts all open findings to the user, `as-needed` puts the findings covered by `rules.askHumanWhen` to the user and you decide the rest, `autonomous` means you decide all of them. Write every decision with its reasoning and who made it to `docs/decisions/<name>/<phase-id>.md` in `<wd>`.

Keep every round summary short (round, verdict per role, number of findings per severity, number of consult questions) and do not load the full documents into your own context.

## 5. Consult questions and human in the loop

**Effective level per phase:** the `humanInTheLoop` of this run (step 0), else the phase's `humanInTheLoop`, else `rules.humanInTheLoop`, else `as-needed`.

| Level | Consult questions | Stalemates |
|---|---|---|
| `autonomous` | answered by a role or by you; never the user | you decide |
| `as-needed` | cases in `rules.askHumanWhen` go to the user, everything else is answered by a role or by you | the same split |
| `always` | every question goes to the user | the user decides |

**Consult block.** If `rules.consult.enabled` is not `false`, add this block to every build and review task (`<max>` = `rules.consult.maxPerRound`, default 3):

```
Consult: If you hit a question that you cannot answer from the inputs and whose answer changes your result, do not guess. Stop and end your reply with this block and nothing after it:
CONSULT
Q1: <question>
Why it matters: <what changes depending on the answer>
Options: <the options you see, your recommendation first>
(Q2, Q3 the same way, if needed)
You will be resumed with the answers and keep your full context. You may stop like this at most <max> times in this task. Settle smaller questions yourself and list them as assumptions at the end of your document.
```

If `rules.consult.enabled` is `false`, add instead: `Settle open questions yourself and list them as assumptions at the end of your document.`

**When a role ends with `CONSULT`**, handle each question:

1. **Who answers.** By the effective level: the user, or a role. With `as-needed` you judge whether the question falls under one of the cases in `rules.askHumanWhen`; if in doubt, it goes to the user.
2. **A role answers.** Take the first suitable role from the asker's `consultWith`; without it, the agent of this pipeline whose description fits the question best, never the asker itself. Start it via the Agent tool (review model) with:
   ```
   Working directory: <absolute path of wd>. Read only there. Do not change any files.
   This is a consult task. Another role working on the phase goal "<goal>" asks:
   <question, why it matters, options>
   Background (read): <inputs of the pipeline and the phase>
   Answer the question with a short reasoning and your confidence (high / medium / low). If you cannot answer it from your expertise and the inputs, reply with exactly: CANNOT ANSWER
   ```
   On `CANNOT ANSWER` or low confidence: with `as-needed` the question goes to the user; with `autonomous` you decide yourself from the inputs and mark the answer as an assumption.
3. **The user answers.** Ask the user, with the `AskUserQuestion` tool if it is available, otherwise as a plain question, and wait for the answer. Name the pipeline, phase and role, the question, why it matters, the options and a recommendation (a role's answer, if there is one). Collect questions that arrive close together into one ask. Phases that are not waiting on an answer keep running.
4. **Record it.** Append question, answer, who answered (role name, `human` or `orchestrator`) and round to the section "Consult questions" of `docs/decisions/<name>/<phase-id>.md` in `<wd>`.
5. **Resume the asker.** Send the answers with `SendMessage` to the asker's agent id (load `SendMessage` via `ToolSearch` if it is not loaded): `Answers to your questions: <Q1: answer ...>. Continue your task from where you stopped.` The asker's result then arrives as a task notification, not as a return value; wait for it before you continue with the round. If resuming fails (for example after a restart of Claude Code), start the role again with its original task plus a section `Answers to earlier questions: ...`.
6. **Limit.** If the asker has already stopped `<max>` times in this task, do not answer further questions; resume it with `No more questions in this round: decide yourself and list your decisions as assumptions at the end of your document.`

## 6. Phases with work packages

If a phase has `workPackages`, read `workPackages.from` (on `<base>`) and treat every package like a small phase of its own:
- Worktree `.claude/worktrees/<name>-<phase-id>-<package-id>` on branch `pipeline/<name>/<phase-id>-<package-id>` (without worktrees: one after another in the project directory).
- Builder from `builderByType[type]`, reviewers from `reviewersByType[type]`, models as in step 4, tasks from `task` and `reviewTask` plus the package description, the requirement IDs and the allowed files. Consult questions and human in the loop work as in section 5.
- A package starts only when all packages in its `dependsOn` are delivered, and it builds on the current `<base>`. Packages without open dependencies run in parallel.
- If a package has a `type` without a builder, stop and report.
- Every package is delivered on its own (step 7). The phase is `done` when all packages are delivered and `rules.preCommit` (if set) succeeds on `<base>`.

## 7. Deliver

When a phase or package is accepted:
1. Check the `acceptance` criteria and that all `outputs` exist. If something is missing, go back to step 4.
2. Write `docs/pipeline-status/<name>/<phase-id>.json` (for packages `<phase-id>-<package-id>.json`) in `<wd>`:
   ```json
   { "pipeline": "<name>", "phase": "<id>", "status": "done", "rounds": 2, "verdicts": { "<agent>": "accepted" }, "consults": { "<role>": 1, "human": 1 }, "decisions": "docs/decisions/<name>/<id>.md", "finishedAt": "<ISO time>" }
   ```
3. Commit in `<wd>` (in code phases only after a successful `rules.preCommit`). Then, depending on `rules.delivery`:
   - `pr-merge`: push the branch, create a pull request into `<base>` and merge it right away.
     ```
     gh pr create --base <base> --head pipeline/<name>/<id> --title "<name>/<id>: <goal>" --body "<summary, verdicts, consult questions, decisions>"
     gh pr merge --merge --delete-branch
     ```
     If the merge has a conflict, merge `origin/<base>` into the branch, resolve the conflict, check again and retry.
   - `pr-open`: push the branch and create a pull request, do not merge. The phase only counts as `done` once a human has merged it. Do not start phases waiting on it; list the open pull requests at the end.
   - `commit`: no pull request. Switch to the project directory, `git checkout <base>`, `git merge --no-ff pipeline/<name>/<id>`, and push `<base>` if a remote exists.
4. Remove the worktree (`git worktree remove .claude/worktrees/<name>-<id>`), set the task to `completed`, update `<base>` in the project directory.
5. Continue with step 1: new phases may be startable now. With `mode: phase` stop after this phase.

## 8. Stop conditions

Stop and report instead of continuing if:
- `gh` is missing for `pr-merge` or `pr-open`, or the push or merge is rejected,
- an agent ends twice in a row without a usable result,
- `rules.preCommit` fails on `<base>` after a merge and one build round does not fix it,
- the validation script reports errors in the status files after a delivery.

The report names the phase, what failed, and how to continue with `/expert-teams:run <name> <phase-id>`. The state is kept in the status files, the branches and the worktrees.

## 9. Wrap-up

When all phases are `done`, print a short summary: phases with their number of rounds, consult questions per phase and who answered them, all stalemate decisions with a link to `docs/decisions/<name>/`, and with `pr-open` the pull requests that are still open.
