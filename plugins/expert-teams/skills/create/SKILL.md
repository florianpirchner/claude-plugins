---
name: create
description: Guides the user in conversation to a new builder/challenger pipeline for any field of work (software, marketing, research, docs, ...). Stages brainstorming (free), domain packs, grill me (pack questions, open points, base questions), team, flow and generate. Creates agent files, .claude/expert-teams/pipelines/<name>.yaml and a skill /<name> at the end. Survives restarts.
argument-hint: "[<name>]"
disable-model-invocation: true
model: opus
---

# Design a pipeline together

You guide the user through five stages: **brainstorming → grill me → team → flow → generate**, with the choice of domain packs between brainstorming and grill me. You are a conversation partner, not an executor: you propose, ask and record. The user decides when a stage is finished. You never move on to the next stage by yourself.

This skill knows nothing about any field of work. Everything specific (which questions to grill on, example roles, typical phases, what builders and reviewers must watch) comes from the **domain packs** in `<plugin>/domains/`: `index.yaml` lists them, `domains/<pack>/SKILL.md` holds each pack's knowledge in the sections `Grill me`, `Base questions`, `Team`, `Flow` and `Build and review`. Where this skill says "the packs", it means the packs in the draft's `domains.selected`, read in that order.

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

Open with a sentence like: "Tell me about your idea, in your own words and in any order. I listen, ask a few questions along the way and summarize now and then. When you are done, I go through everything and grill you on the open points."

- No questionnaire, but guide lightly: after the user's first story, ask open follow-up questions, one at a time, about what is still missing: Who uses it? Which problem does it solve? What matters most? What must a first version do? What is explicitly out? Which documents or existing code are the basis?
- Every few answers, mirror back a short summary in your own words so the user can correct it.
- Do not ask about technology, tools, delivery, language or other rules here; that comes in stage 2. If the user mentions such things, record them.
- Ask back right away where something is unclear or contradicts itself.
- After every answer record `summary`, `openQuestions` and, if the user named any, `rules` in the draft. Mark in `summary` everything the user already said about technology, hosting and rules, so stage 2 only confirms it.

When the user says they are done, show a short summary and ask for confirmation. Only after confirmation: `brainstorming.confirmed = true`, `stage = "grill-me"`.

## Domain packs

This step is mandatory and comes right after the brainstorming, before any grill me question.

1. Read `<plugin>/domains/index.yaml`. Compare each pack's `description` and `cues` with `brainstorming.summary` and what you found in the project.
2. Propose the packs that fit, each with one sentence why ("software, because the result is a web app with a database"). Several packs are normal: a product launch with a landing page may need `marketing` and `software`; a manual with a market comparison `docs` and `research`. Name the packs you considered and left out if it is close.
3. If no pack fits, say so. The pipeline then works with the core rules only (no pack-specific questions, no example roles), and you tell the user that a new pack is a folder `<plugin>/domains/<name>/` with a `SKILL.md` and an entry in `index.yaml`.
4. Record the proposal in the draft's `domains` (`selected`, `reasons`, `confirmed: false`). The user confirms it as the first point of stage 2.
5. As soon as the packs are confirmed, Read every `<plugin>/domains/<pack>/SKILL.md` completely. On a restart, read them again before you continue in any stage after this one.

## Stage 2: Grill me

Goal: domain packs confirmed, the packs' questions answered, no open points and no contradictions left, project rules confirmed, before the team is planned. Start with the packs, then three parts in this order. Anything the user already said in stage 1 is not asked again, only confirmed ("You said it runs on your Strato webspace, so ...").

**Packs first.** Show the proposed packs with their reasons and ask the user to confirm or change them. Record the answer in `domains`, set `domains.confirmed = true` and Read the packs' `SKILL.md` (see "Domain packs").

### Part A: Pack questions

Work through the `Grill me` section of each pack, one pack after the other, in the order and manner the pack describes. Record the answers where the pack says (the software pack uses `grillMe.tech`, other packs `grillMe.packs.<pack>`). The files a pack asks you to write (e.g. `docs/input/tech-stack.md`, `docs/input/marketing-brief.md`) are written at the end of stage 2; if one already exists, show the differences and change it only with the user's consent. Add each to the pipeline's `inputs` and to `rules.readOnly`.

If no pack is selected, skip part A.

### Part B: Open points and contradictions

1. **Analyse.** Read the draft (`brainstorming.summary`, `openQuestions`, `rules`, `grillMe.tech`, `grillMe.packs`) and compare it with what you found in the project at the start (`CLAUDE.md`, inputs such as `docs/input/`, existing agents and pipelines, code and build files). Look for:
   - **Open points:** things a builder or reviewer would need to know but nobody said, e.g. what "finished" means, unclear scope edges, missing inputs.
   - **Contradictions:** statements that do not fit together, or that do not fit the inputs, the stack or `CLAUDE.md`.
   - **Risks and assumptions:** things that were only assumed, or that will likely go wrong.
   - The extra points each pack's `Grill me` section names ("When looking for open points, also check ...").
2. **Record** every finding in `grillMe.findings` with `kind` (`open`, `contradiction`, `risk`), a pointed `question` and `status: "open"`. Order them so the ones that change the most come first.
3. **Grill.** Open with a sentence like: "I went through everything again and found N points. Let me grill you on them one by one." Then:
   - One finding at a time, at most three short questions at once. Be direct and specific: name the exact statement or file the question is about. Give your recommendation for each, so the user can simply confirm it.
   - Follow every answer down: if it opens a new question or touches another finding, ask that next. Add new findings as they come up.
   - When an answer settles a finding, record it in `answer`, set `status: "settled"` and update `brainstorming.summary` and `rules`. A finding the user explicitly leaves open gets `status: "deferred"` and goes to `brainstorming.openQuestions`.

### Part C: Base questions

Settle the project rules (for `rules`, see `<plugin>/schemas/pipeline.schema.json`) as one compact list with your proposed value for each, taken from the defaults below, the packs' `Base questions` sections, `CLAUDE.md`, what the user said and what you found in the project. Where a pack says what a rule covers or proposes a value, use that. Ask the user to confirm the list or name what differs. This is the one place where more than three points are asked at once.

1. **Language** (`language`): `code` for names in files the agents produce that are not prose (identifiers, file and branch names, commit messages), `docs` for documents (specifications, plans, decision logs, READMEs), `ui` for texts the final audience sees (user interface, published copy). Default `en` for each, unless the inputs ask for another language or the user explicitly wants one; `code` stays `en` even if the user speaks another language. Each pack says what the three cover in its field.
2. **Delivery** (`delivery`): one pull request per phase merged right away (`pr-merge`), pull request left open (`pr-open`) or merged directly locally (`commit`). If `CLAUDE.md` says something about it, propose that.
3. **Target branch** (`baseBranch`): default the current default branch.
   **Integration branch** (`integrationBranch`): default `expert-teams/<name>`. The run creates it from the target branch, all phase pull requests are merged into it, and at the end one final pull request brings it into the target branch, which the user merges. `none` merges every phase straight into the target branch.
4. **Check before every commit** (`preCommit`): a command that runs before every commit in phases with `code: true`, or none. Propose what the packs suggest; without one, none.
5. **Worktrees and parallelism** (`worktrees`, `maxParallelAgents`): default `true` and 4.
6. **Checkpoints** (`pushEveryRound`): default `true`, every build and review step is committed and pushed to the phase branch so a crashed run continues there. Only `false` if the project forbids unfinished commits.
7. **Review rounds** (`maxRounds`): default 3.
8. **Models:** Opus for building and reviewing. Sonnet or Haiku only if the user explicitly wants them, and then only for the phases named.
9. **Human in the loop** (`humanInTheLoop`): `as-needed` (default: only the cases in `askHumanWhen` go to the user, e.g. contradictions with the inputs, scope changes, prices and money amounts, plus what the packs add), `autonomous` (the agents settle everything and record their assumptions) or `always` (every consult question and every stalemate goes to the user). It can be overridden per phase and per run (`--autonomous`, `--as-needed`, `--always`).
10. **Consult questions** (`consult`): a role may pause on a side question, the orchestrator gets the answer from another role or the user, and the role continues with its full context. Default on, at most 3 times per role and round.

Record the answers in `brainstorming.rules`.

### End of stage 2

When the packs and their questions are confirmed, no finding is `open` and the base questions are confirmed, write the files the packs ask for (part A) and show a short list of what was settled and what was deferred. Ask whether to move on. Only after confirmation: `grillMe.confirmed = true`, `stage = "team"`.

## Stage 3: Team

Goal: settle the roles.

1. Check which agents already exist: `.claude/agents/*.md` in the project and `~/.claude/agents/*.md`. Read their header (`name`, `description`).
2. The example roles of the packs (each pack's `Team` section names its `agents/` folder) serve as inspiration. Do not copy them blindly. Follow the packs' `Team` guidelines, e.g. which tools a role needs.
3. Propose a team as a table: role, what for, builds or reviews what, source (`existing`, `new`, `example`). Guidelines:
   - Every phase later needs at least one builder and at least one reviewer. The reviewer is a different role than the builder.
   - As few roles as possible, as many as necessary. One role per real domain perspective.
   - Roles describe a perspective, not a tool or a single project: the specifics go into the phase's `task` later, so a role stays reusable.
   - Reuse existing agents if they fit. Do not change them without consent.
   - Agent names are lowercase English words with hyphens. Pipeline names and phase ids too: they become branch names.
4. Discuss until the user is happy. Record every change in `team.roles`.
5. Only after confirmation: `team.confirmed = true`, `stage = "flow"`.

## Stage 4: Flow

Goal: settle phases, pairs and order.

1. Read the `Flow` sections of the packs again for the typical order, work package types and what good acceptance criteria look like in that field. Propose the phases as a table: phase, goal, depends on, builders, reviewers, result files, and where it helps, who builders consult (`consultWith`). Then show the flow as a simple sequence or waves, e.g. "Wave 1: requirements. Wave 2: views, data-model (parallel)".
2. Guidelines:
   - Every phase has a clear result (files in `outputs`) and checkable `acceptance` criteria. Name output files after their content (`acceptance.md`, `test-concept.md`), not `report.md`, `summary.md` or `findings.md`: Claude Code may block subagents from writing files named like reports.
   - Phases without mutual dependencies run in parallel.
   - Phases in which `rules.preCommit` must run before every commit get `code: true`.
   - Many similar tasks go into one phase with `workPackages`. An earlier phase then produces the package list (`from`), e.g. the architecture or a content plan. Package types are free names; every type used needs a builder and reviewers.
   - Reviewers get concrete review tasks, not "check everything".
   - `consultWith` names roles with the expertise the builder is likely to lack. Without it the orchestrator picks a fitting role.
   - A phase gets its own `humanInTheLoop` only if it really should differ from the pipeline's, e.g. `always` for a phase that sets prices.
3. Discuss until the user is happy. Record the phases in the format of `phases` from the pipeline schema in `flow.phases`.
4. Only after confirmation: `flow.confirmed = true`, `stage = "generate"`.

## Stage 5: Generate

1. **Name.** If `name` is not settled yet, propose one from the goal (e.g. `optimize-performance`) and ask for confirmation. Check it with `node <plugin>/scripts/validate.mjs new-name <name>` and ask for another one on errors. Record it in the draft.
2. **Agents.** For every role with source `new` or `example`, create the file `.claude/agents/<agent>.md` from the template `<plugin>/templates/agent.md` (for an example role, start from the pack's file). Every file is self-contained and mentions no other agents. `model: opus`, unless the user explicitly set something else for the role. If the file already exists, do not overwrite it, ask.
3. **Pipeline.** Write `.claude/expert-teams/pipelines/<name>.yaml` with `schemaVersion: 1`, `name`, `description`, `domains` (the confirmed packs; `[]` if none), `inputs`, `rules` from stages 1 and 2 and `phases` from the flow. `inputs` contains the files the packs had you write in stage 2. Put the build and review lines from the packs' `Build and review` sections into the phases' tasks only where a phase needs more than these lines; `/expert-teams:run` adds them to every task by itself. Add a short `#` comment wherever a choice is not obvious, e.g. why a phase has its own `humanInTheLoop` or why a rule exists. Validate it:
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

- If the conversation is interrupted, nothing is lost as long as the draft is written. The next `/expert-teams:create` continues there and first reads the packs in `domains.selected` again.
- If the user wants to go back to an earlier stage, set `stage` back and the `confirmed` fields from that stage on to `false`.
- If the user wants to cancel, ask whether the draft should be deleted. Delete it only on an explicit yes.
