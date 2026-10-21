---
name: software
description: Domain pack of expert-teams for building software. Read by /expert-teams:create, modify and run when the pipeline lists software in domains; not a skill to invoke on its own.
disable-model-invocation: true
---

# Domain pack: software

Knowledge for pipelines that build software. The core skills read the section they need: create and modify all of them, run only "Build and review". `<pack>` below is the directory of this file.

## Grill me

Settle the technology before the open points. Ask first: "Do you already have a fixed idea of the technology and where it runs, or should I advise you?"

- **Fixed idea:** take over the stack and the operation the user names. Check it only for contradictions with the brainstorming and the project (existing code, `CLAUDE.md`, a webspace that cannot run Node).
- **Advice:** read `<pack>/stack-guide.md` and walk the user through its questions, one or two at a time, from the hard limits towards the technology, never the other way round: where it runs, who maintains it and which language that person knows, how many users and how sensitive the data is, whether it needs offline use, a mobile app or real time. Then propose one stack with a short reason per part and the alternative you rejected. Never propose a stack the stated hosting cannot run.

Record the result in the draft's `grillMe.tech` (`mode`: `given` or `advised`, `stack`, `hosting`, `reasons`). At the end of grill me write it to `docs/input/tech-stack.md` (in `rules.language.docs`): stack per layer, hosting and operation, the limits it follows from, rejected alternatives. If the file exists, show the differences and change it only with the user's consent. Add it to the pipeline's `inputs` and to `rules.readOnly`.

When looking for open points, also check: what "finished" means for the code (tests, coverage, a running build), existing code the pipeline must not break, data that must be migrated, secrets and how they are handled.

## Base questions

- **Language:** `code` covers identifiers, database tables and columns, API paths and fields, code comments, log messages, test names, commit messages and branch names; default `en` even if the user speaks another language, change it only if the user explicitly asks. `docs` covers specifications, architecture and decision logs; `ui` covers texts the end users see.
- **Check before every commit** (`preCommit`): propose the command that fits the stack, e.g. `npm run check` (lint, type check, tests), `pnpm check`, `mvn verify`, `pytest`. If `CLAUDE.md` names one, take that.
- **Ask the user when** (`askHumanWhen`), in addition to the core proposals: changes to the data model of existing data, anything that touches security or personal data.

## Team

- Example roles: `<pack>/agents/` (13 roles of an internal business tool: product-manager, software-architect, backend-developer, frontend-developer, database-expert, tester, devops, privacy-security, ux-dataviz and domain reviewers). Use them as inspiration, do not copy them blindly.
- Roles stay technology-neutral unless a role must be bound to a technology. The technology goes into the phase's `task`. A role like `senior-ui-dev` then works for React and for Vue.
- Roles that run commands (build, tests) need `Bash` in `tools`; pure document reviewers do not.

## Flow

- A typical order: requirements, then domain rules and user flows in parallel, then data model and architecture, then infrastructure, implementation and acceptance. Leave out what the project does not need.
- Phases that change code get `code: true`, so `rules.preCommit` runs before every commit in them.
- Many similar implementation tasks go into one phase with `workPackages`. The architecture phase produces the package list (`from`, a YAML file). Usual package types: `backend`, `frontend`, `database`; add others where the project has them (e.g. `calculation`, `infrastructure`). Every type needs a builder and reviewers.
- One builder per phase. A result that needs two specialists (e.g. architecture and views) becomes two phases; the other specialist reviews or consults.
- Acceptance criteria name a command and its expected result where possible (`npm test passes`), not only a description.

## Build and review

Add these lines to every build and review task of the pipeline:

```
Code in <code>: identifiers, database tables and columns, API paths and fields, code comments, log messages, test names and commit messages. Translate terms from the inputs instead of copying them, e.g. a German "Stundensatz" becomes "hourly_rate".
Keep tests next to the code you change and run them before you hand over. Do not disable, skip or weaken a test or a check to make it pass.
```

Add this line to every review task:

```
Run the tests and the check command yourself instead of trusting the builder's report. Code in the wrong language is a blocking finding.
```
