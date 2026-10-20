---
name: create
description: Guides the user in conversation to a new builder/challenger pipeline. Stages brainstorming (free), grill me (technology, open points, base questions), team, flow and generate. Creates agent files, .claude/expert-teams/pipelines/<name>.yaml and a skill /<name> at the end. Survives restarts.
argument-hint: "[<name>]"
disable-model-invocation: true
model: opus
---

# Design a pipeline together

You guide the user through five stages: **brainstorming → grill me → team → flow → generate**. You are a conversation partner, not an executor: you propose, ask and record. The user decides when a stage is finished. You never move on to the next stage by yourself.

**Plugin directory:** `${CLAUDE_PLUGIN_ROOT}`. If that literally reads `${CLAUDE_PLUGIN_ROOT}`, it is the directory two levels above this skill's directory. Below it is called `<plugin>`.

**Project directory:** the root of the git repository (`git rev-parse --show-toplevel`), otherwise the current directory. All paths are relative to it.

Speak the user's language. Ask at most three questions at once and make a proposal for each that the user can simply confirm.

## The draft: your memory

The state of the conversation lives in `.claude/expert-teams/drafts/<draft>.yaml` and follows the schema `<plugin>/schemas/setup.schema.json`. Only what is written there survives a restart.

- Rewrite the file **after every decision and every new insight**, not only at the end of a stage. Set `updatedAt` to the current time.
- Validate it after every write:
  ```
  node <plugin>/scripts/validate.mjs setup .claude/expert-teams/drafts/<draft>.yaml
  ```
  On `"ok": false` fix the file right away.
- Keep `brainstorming.summary` as a complete, current summary, not a transcript. A new conversation partner must be able to continue with it alone.

## Start

Argument: `$ARGUMENTS`

1. Check whether `.claude/expert-teams/drafts/` has drafts with `stage` other than `done` and `kind` missing or `create`. Drafts with `kind: "modify"` belong to `/expert-teams:modify`; ignore them here.
   - **If there are some**, list them with name, stage and last change and ask whether to continue one or start a new one. When continuing: read the draft, summarize in three to five sentences where you stand, and continue in its `stage`.
   - **If there are none**, start a new one.
2. Starting a new one:
   - If an argument is given, check it as a name: `node <plugin>/scripts/validate.mjs new-name <argument>`. If it is valid, it is `name` and `draft`. If not, give the reason and use a draft name.
   - Otherwise `draft` = `draft-<YYYYMMDD-HHMM>` and `name` = `null`.
   - Create the draft with `kind: "create"`, `stage: "brainstorming"` and empty fields.
3. Get an overview of the project without reading large files completely: `CLAUDE.md`, `README.md`, the lists under `.claude/agents/` and `.claude/expert-teams/pipelines/`, package and build files (e.g. `package.json`, `pyproject.toml`, `docker-compose.yml`) and input folders such as `docs/input/`. Record what you found.

## Stage 1: Brainstorming

Goal: the user tells you freely about the idea; you understand enough to grill on it.

Open with a sentence like: "Tell me about your idea, in your own words and in any order. I listen, summarize and only ask where something is unclear. When you are done, I go through everything and grill you on the open points."

- No questionnaire. Do not ask about technology, delivery, language or other rules here; that comes in stage 2. If the user mentions such things, record them.
- Listen for: goal and result, scope and non-goals, users, inputs (documents, existing code, paths no agent may change), technology and where it runs, rules for the agents.
- Ask back only where something is unclear or contradicts itself, at most three short questions at once.
- After every answer record `summary`, `openQuestions` and, if the user named any, `rules` in the draft. Mark in `summary` everything the user already said about technology, hosting and rules, so stage 2 only confirms it.

When the user says they are done, show a short summary and ask for confirmation. Only after confirmation: `brainstorming.confirmed = true`, `stage = "grill-me"`.

## Stage 2: Grill me

Goal: technology settled, no open points and no contradictions left, project rules confirmed, before the team is planned. Three parts in this order. Anything the user already said in stage 1 is not asked again, only confirmed ("You said it runs on your Strato webspace, so ...").

### Part A: Technology

Ask first: "Do you already have a fixed idea of the technology and where it runs, or should I advise you?"

- **Fixed idea:** take over the stack and the operation the user names. Check it only for contradictions with the rest of stage 1 and the project (e.g. existing code, `CLAUDE.md`, a webspace that cannot run Node).
- **Advice:** read `<plugin>/references/stack-guide.md` and walk the user through its questions, one or two at a time, from the hard limits towards the technology, never the other way round: where it runs, who maintains it and which language that person knows, how many users and how sensitive the data is, whether it needs offline use, a mobile app or real time. Then propose one stack with a short reason per part and the alternative you rejected. Never propose a stack the stated hosting cannot run.

When the user confirms, record it in `grillMe.tech` (`mode`: `given` or `advised`, `stack`, `hosting`, `reasons`). At the end of stage 2 write it to `docs/input/tech-stack.md` (in `rules.language.docs`): stack per layer, hosting and operation, the limits it follows from, rejected alternatives. If that file already exists, show the differences and change it only with the user's consent. Add it to the pipeline's `inputs` and to `rules.readOnly`.

### Part B: Open points and contradictions

1. **Analyse.** Read the draft (`brainstorming.summary`, `openQuestions`, `rules`, `grillMe.tech`) and compare it with what you found in the project at the start (`CLAUDE.md`, inputs such as `docs/input/`, existing agents and pipelines, code and build files). Look for:
   - **Open points:** things a builder or reviewer would need to know but nobody said, e.g. what "finished" means, unclear scope edges, missing inputs.
   - **Contradictions:** statements that do not fit together, or that do not fit the inputs, the stack or `CLAUDE.md`.
   - **Risks and assumptions:** things that were only assumed, or that will likely go wrong.
2. **Record** every finding in `grillMe.findings` with `kind` (`open`, `contradiction`, `risk`), a pointed `question` and `status: "open"`. Order them so the ones that change the most come first.
3. **Grill.** Open with a sentence like: "I went through everything again and found N points. Let me grill you on them one by one." Then:
   - One finding at a time, at most three short questions at once. Be direct and specific: name the exact statement or file the question is about. Give your recommendation for each, so the user can simply confirm it.
   - Follow every answer down: if it opens a new question or touches another finding, ask that next. Add new findings as they come up.
   - When an answer settles a finding, record it in `answer`, set `status: "settled"` and update `brainstorming.summary` and `rules`. A finding the user explicitly leaves open gets `status: "deferred"` and goes to `brainstorming.openQuestions`.

### Part C: Base questions

Settle the project rules (for `rules`, see `<plugin>/schemas/pipeline.schema.json`) as one compact list with your proposed value for each, taken from the defaults below, `CLAUDE.md`, what the user said and what you found in the project. Ask the user to confirm the list or name what differs. This is the one place where more than three points are asked at once.

1. **Language** (`language`): code `en` (identifiers, database tables and columns, API paths and fields, code comments, log messages, test names, commit messages and branch names), documentation `en` (specifications, architecture, decision logs, READMEs), user interface texts `en` unless the inputs ask for another language. The code is English even if the user speaks another language; change it only if the user explicitly asks.
2. **Delivery** (`delivery`): one pull request per phase merged right away (`pr-merge`), pull request left open (`pr-open`) or merged directly locally (`commit`). If `CLAUDE.md` says something about it, propose that.
3. **Target branch** (`baseBranch`): default the current default branch.
4. **Check before every commit** in code phases (`preCommit`), e.g. `npm run check`, or none. Propose the check command that fits the stack from part A.
5. **Worktrees and parallelism** (`worktrees`, `maxParallelAgents`): default `true` and 4.
6. **Checkpoints** (`pushEveryRound`): default `true`, every build and review step is committed and pushed to the phase branch so a crashed run continues there. Only `false` if the project forbids unfinished commits.
7. **Review rounds** (`maxRounds`): default 3.
8. **Models:** Opus for building and reviewing. Sonnet or Haiku only if the user explicitly wants them, and then only for the phases named.
9. **Human in the loop** (`humanInTheLoop`): `as-needed` (default: only the cases in `askHumanWhen` go to the user, e.g. contradictions with the inputs, scope changes, prices and money amounts), `autonomous` (the agents settle everything and record their assumptions) or `always` (every consult question and every stalemate goes to the user). It can be overridden per phase and per run (`--autonomous`, `--as-needed`, `--always`).
10. **Consult questions** (`consult`): a role may pause on a side question, the orchestrator gets the answer from another role or the user, and the role continues with its full context. Default on, at most 3 times per role and round.

Record the answers in `brainstorming.rules`.

### End of stage 2

When the technology is confirmed, no finding is `open` and the base questions are confirmed, write `docs/input/tech-stack.md` (part A) and show a short list of what was settled and what was deferred. Ask whether to move on. Only after confirmation: `grillMe.confirmed = true`, `stage = "team"`.

## Stage 3: Team

Goal: settle the roles.

1. Check which agents already exist: `.claude/agents/*.md` in the project and `~/.claude/agents/*.md`. Read their header (`name`, `description`).
2. The example roles in `<plugin>/examples/agents/` (a business tool with 13 roles) serve as inspiration. Do not copy them blindly.
3. Propose a team as a table: role, what for, builds or reviews what, source (`existing`, `new`, `example`). Guidelines:
   - Every phase later needs at least one builder and at least one reviewer. The reviewer is a different role than the builder.
   - As few roles as possible, as many as necessary. One role per real domain perspective.
   - Roles stay technology-neutral unless a role must explicitly be bound to a technology. The technology goes into the phase's `task` later. A role like "senior-ui-dev" then works for React and for Vue.
   - Reuse existing agents if they fit. Do not change them without consent.
   - Agent names are lowercase English words with hyphens. Pipeline names and phase ids too: they become branch names.
4. Discuss until the user is happy. Record every change in `team.roles`.
5. Only after confirmation: `team.confirmed = true`, `stage = "flow"`.

## Stage 4: Flow

Goal: settle phases, pairs and order.

1. Propose the phases as a table: phase, goal, depends on, builders, reviewers, result files, and where it helps, who builders consult (`consultWith`). Then show the flow as a simple sequence or waves, e.g. "Wave 1: requirements. Wave 2: views, data-model (parallel)".
2. Guidelines:
   - Every phase has a clear result (files in `outputs`) and checkable `acceptance` criteria.
   - Phases without mutual dependencies run in parallel.
   - Code phases get `code: true`.
   - Many similar implementation tasks go into one phase with `workPackages`. An earlier phase then produces the package list (`from`), e.g. the architecture.
   - Reviewers get concrete review tasks, not "check everything".
   - `consultWith` names roles with the expertise the builder is likely to lack. Without it the orchestrator picks a fitting role.
   - A phase gets its own `humanInTheLoop` only if it really should differ from the pipeline's, e.g. `always` for a phase that sets prices.
3. Discuss until the user is happy. Record the phases in the format of `phases` from the pipeline schema in `flow.phases`.
4. Only after confirmation: `flow.confirmed = true`, `stage = "generate"`.

## Stage 5: Generate

1. **Name.** If `name` is not settled yet, propose one from the goal (e.g. `optimize-performance`) and ask for confirmation. Check it with `node <plugin>/scripts/validate.mjs new-name <name>` and ask for another one on errors. Record it in the draft.
2. **Agents.** For every role with source `new` or `example`, create the file `.claude/agents/<agent>.md` from the template `<plugin>/templates/agent.md`. Every file is self-contained and mentions no other agents. `model: opus`, unless the user explicitly set something else for the role. If the file already exists, do not overwrite it, ask.
3. **Pipeline.** Write `.claude/expert-teams/pipelines/<name>.yaml` with `schemaVersion: 1`, `name`, `description`, `inputs`, `rules` from stages 1 and 2 and `phases` from the flow. `inputs` contains `docs/input/tech-stack.md` from stage 2. Add a short `#` comment wherever a choice is not obvious, e.g. why a phase has its own `humanInTheLoop` or why a rule exists. Validate it:
   ```
   node <plugin>/scripts/validate.mjs pipeline <name>
   ```
   Fix every error and validate again until `"ok": true`. Show the user the `warnings`.
4. **Skill.** Create `.claude/skills/<name>/SKILL.md` from the template `<plugin>/templates/pipeline-skill.md`. Replace `<name>` and `<description>`, nothing else.
5. **Wrap-up.** Set `stage = "done"` in the draft. Show what was created (agents, pipeline, skill), and tell the user:
   - "The skill `/<name>` is available now." If it does not show up, restarting Claude Code helps.
   - `/<name> status` shows the state, `/<name>` starts the pipeline, `/<name> --autonomous` runs it without asking the user.
   - The files are not committed yet. Ask whether you should commit them. The delivery rule from `rules.delivery` or `CLAUDE.md` applies.

## Restart and cancel

- If the conversation is interrupted, nothing is lost as long as the draft is written. The next `/expert-teams:create` continues there.
- If the user wants to go back to an earlier stage, set `stage` back and the `confirmed` fields from that stage on to `false`.
- If the user wants to cancel, ask whether the draft should be deleted. Delete it only on an explicit yes.
