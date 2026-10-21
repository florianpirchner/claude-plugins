---
name: research
description: Domain pack of expert-teams for research and analysis (market, technology, competitors, options). Read by /expert-teams:create, modify and run when the pipeline lists research in domains; not a skill to invoke on its own.
disable-model-invocation: true
---

# Domain pack: research

Knowledge for pipelines that research and analyse: markets, technologies, competitors, options for a decision. The builder researches and writes; the reviewer checks sources and evidence. The result is documents with sources. The core skills read the section they need: create and modify all of them, run only "Build and review". `<pack>` below is the directory of this file.

## Grill me

Settle the research question before the open points, one or two questions at a time, skipping what the brainstorming already answered:

1. **Question and decision:** which question must the research answer, and which decision depends on it? A question without a decision tends to grow without end.
2. **Scope:** markets, regions, time frame, which options or competitors are in and which are out.
3. **Sources:** may the agents search the web (they need `WebSearch` and `WebFetch` in `tools`), or only use the documents in the repository? Paid or internal sources the user provides?
4. **Evidence bar:** what counts as a reliable source (official statistics, vendor documentation, peer-reviewed studies, at least two independent sources for a key number)? How old may a source be?
5. **Form of the answer:** a recommendation with reasons, a comparison table, a ranked list? Who reads it, and how long may it be?

At the end of grill me write the answers to `docs/input/research-brief.md` (in `rules.language.docs`). If the file exists, show the differences and change it only with the user's consent. Add it to the pipeline's `inputs` and to `rules.readOnly`.

When looking for open points, also check: criteria for comparing options that nobody named, a time frame that the sources cannot cover, a decision the user has already made (then the research only confirms it, say so).

## Base questions

- **Language:** `docs` covers everything the pipeline writes. `code` and `ui` are only needed if a phase writes scripts or published text.
- **Check before every commit** (`preCommit`): usually none. A link check of the sources is a good one if the project has a tool for it.
- **Ask the user when** (`askHumanWhen`): the evidence contradicts an assumption of the brief, a key number has only one source, the scope must grow to answer the question, a source is behind a paywall or needs an account.
- **Web access:** if the brief allows web research, the builder roles need `WebSearch` and `WebFetch` in `tools`, the reviewers at least `WebFetch` to check the cited pages.

## Team

- Example roles: `<pack>/agents/`: `researcher` (searches, reads, writes findings with sources) and `fact-checker` (checks every claim against its source, looks for contrary evidence). For a decision add a role of the field as second reviewer (e.g. `software-architect` for a technology choice, `controller` for numbers).
- Researcher and fact-checker are different roles; the fact-checker never reviews its own text.

## Flow

- A typical order: question and criteria, then research (often split by option, market or competitor as work packages, type e.g. `option`, `competitor`, `market`), then comparison, then recommendation. Leave out what the question does not need.
- Every finding has a source: link or document, date and the exact passage. Numbers name their unit, date and source.
- Acceptance criteria are checkable: every claim cited, every option compared against every criterion, contrary evidence named, the recommendation follows from the comparison.
- Name outputs after their content (`options.md`, `comparison.md`, `recommendation.md`), not `report.md`.

## Build and review

Add these lines to every build and review task of the pipeline:

```
Documents in <docs>. Every claim and every number has a source: link or document, date and the passage it comes from. Mark estimates and assumptions as such.
Separate what the sources say from your own conclusions. Name evidence that speaks against your conclusion.
Use only the sources the brief allows (docs/input/research-brief.md).
```

Add this line to every review task:

```
Open the cited sources and check that they say what the text claims. A claim without a source, a misquoted source or a missing contrary source you found is a blocking finding.
```
