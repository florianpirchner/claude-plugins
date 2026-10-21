---
name: docs
description: Domain pack of expert-teams for documentation (manuals, guides, specifications, READMEs, API docs). Read by /expert-teams:create, modify and run when the pipeline lists docs in domains; not a skill to invoke on its own.
disable-model-invocation: true
---

# Domain pack: docs

Knowledge for pipelines that write documentation: user manuals, how-to guides, specifications, READMEs, API references, onboarding material. The builder writes; the reviewer reads as the target reader and tries to follow the text. The core skills read the section they need: create and modify all of them, run only "Build and review". `<pack>` below is the directory of this file.

## Grill me

Settle the documentation brief before the open points, one or two questions at a time, skipping what the brainstorming already answered:

1. **Readers and tasks:** who reads it (end users, administrators, developers, new colleagues), what do they want to get done with it, and what do they already know?
2. **Kind of documents:** tutorials (learn), how-to guides (do a task), reference (look up), explanation (understand). Which ones are needed, and which exist already?
3. **Source of truth:** what the documentation describes and where the facts come from (the code in the repository, a running system, specifications, interviews). May the agents run the software or commands to check steps?
4. **Form:** file format and location (Markdown in `docs/`, a docs site generator), structure, style guide, screenshots, length limits, languages.
5. **Maintenance:** who keeps it current, and what must happen when the described thing changes?

At the end of grill me write the answers to `docs/input/docs-brief.md` (in `rules.language.docs`). If the file exists, show the differences and change it only with the user's consent. Add it to the pipeline's `inputs` and to `rules.readOnly`.

When looking for open points, also check: features the documentation must cover that the source of truth does not explain, readers with different levels that one text cannot serve, steps that cannot be checked without access the agents lack.

## Base questions

- **Language:** `docs` covers the documentation itself; translations are separate phases with their own reviewers. `code` covers code examples and commands in the text if they differ.
- **Check before every commit** (`preCommit`): a docs build, link check or Markdown lint if the project has one (e.g. `npm run docs:build`, `markdownlint docs/`); mark the phases it applies to with `code: true`. Otherwise none.
- **Ask the user when** (`askHumanWhen`): the documentation and the source of truth disagree (the doc must not silently "fix" the product), a feature is unclear or undocumented anywhere, something would be documented as supported that nobody confirmed.

## Team

- Example roles: `<pack>/agents/`: `technical-writer` (writes and structures) and `reader-reviewer` (reads as the target reader, follows every step, reports where they get stuck). For technical accuracy add an expert of the subject as second reviewer (e.g. `backend-developer` for API docs).
- Roles that run commands or the software to check steps need `Bash` in `tools`.

## Flow

- A typical order: outline (readers, documents, structure), then the documents (often as work packages per chapter or page, type e.g. `tutorial`, `how-to`, `reference`, `explanation`), then a full read-through, then translations if needed.
- Every step in a guide is checkable: a command and its expected output, or a screen and what the reader sees.
- Acceptance criteria are checkable: every task of the readers is covered, every step was followed once by a reviewer, every code example runs, links work.
- Name outputs after their content (`installation.md`, `api-reference.md`), not `report.md`.

## Build and review

Add these lines to every build and review task of the pipeline:

```
Documentation in <docs>, for the readers in docs/input/docs-brief.md. Code examples and commands in <code> where they contain names.
Describe what the source of truth does, not what it should do. If they disagree, raise a consult question instead of choosing.
Every step can be followed: a command with its expected result, or what the reader sees.
```

Add this line to every review task:

```
Read as the target reader and follow every step yourself where you can. A step that does not work, a missing prerequisite or a statement that contradicts the source of truth is a blocking finding.
```
