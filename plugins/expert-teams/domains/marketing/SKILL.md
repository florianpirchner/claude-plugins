---
name: marketing
description: Domain pack of expert-teams for planning and writing marketing. Read by /expert-teams:create, modify and run when the pipeline lists marketing in domains; not a skill to invoke on its own.
disable-model-invocation: true
---

# Domain pack: marketing

Knowledge for pipelines that plan and write marketing: research, positioning, campaigns, content, measurement. The result is documents and drafts in the repository. The agents never publish, post, send or buy anything; a human does that. The core skills read the section they need: create and modify all of them, run only "Build and review". `<pack>` below is the directory of this file.

## Grill me

Settle the brief before the open points, one or two questions at a time, skipping what the brainstorming already answered:

1. **Goal and measure:** what should change, by how much, by when (e.g. 200 newsletter sign-ups in 8 weeks)? Which number tells whether it worked?
2. **Audience:** who exactly, with which problem, where do they look for a solution? One primary segment; others only if the user insists.
3. **Offer and positioning:** what is offered, at which price, against which alternatives, and why choose it? What may not be claimed (unproven numbers, comparisons with named competitors)?
4. **Channels and budget:** which channels exist already (website, newsletter, LinkedIn, ads accounts), which are new, how much money and time is available?
5. **Voice and assets:** tone of voice, words to use and avoid, existing brand guide, logos, photos, customer quotes that may be used (only with consent).
6. **Rules:** markets and languages, legal limits (imprint, consent for emails under GDPR, labelling of ads), who approves before anything goes out.

At the end of grill me write the answers to `docs/input/marketing-brief.md` (in `rules.language.docs`): goal and measure, audience, offer and positioning, channels and budget, voice, rules. If the file exists, show the differences and change it only with the user's consent. Add it to the pipeline's `inputs` and to `rules.readOnly`.

When looking for open points, also check: numbers or claims without a source, a goal without a measure, channels without anyone to run them, timing that collides with the offer (e.g. a launch before the product exists).

## Base questions

- **Language:** `docs` covers the plans and briefs; `ui` covers the published copy (posts, emails, landing page, ads), which follows the market, e.g. German copy for a German audience with English plans. `code` is only needed if a phase writes code (e.g. tracking snippets); otherwise leave it at the default.
- **Check before every commit** (`preCommit`): usually none. If the project has one (spell check, link check, a site build), take it and mark the phases it applies to with `code: true`.
- **Delivery:** pull requests work well for review of copy. `commit` is fine for a project without GitHub.
- **Ask the user when** (`askHumanWhen`): budget and prices, claims about competitors, numbers or quotes without a source, anything that would be published under a person's name, changes to the goal or the audience.
- **Human in the loop:** `as-needed` is the usual choice; copy for a new brand voice often warrants `always` for the messaging phase.

## Team

- Example roles: `<pack>/agents/`: `marketing-strategist` (research, positioning, plan), `copywriter` (all copy), `marketing-analyst` (metrics, tracking plan, plausibility of numbers), `brand-reviewer` (voice, consistency, claims and legal limits). Use them as inspiration, do not copy them blindly.
- The copywriter should not review its own copy; the brand reviewer and the strategist review it. Positioning (strategist) and voice guide (copywriter) are two phases, each with one builder; the other role consults or reviews.
- Marketing roles need no `Bash` unless they run a check command.

## Flow

- A typical order: research (audience and alternatives), then positioning and messaging, then the channel and campaign plan, then content, then the measurement plan, then a launch review. Leave out what the project does not need; research and measurement plan can run in parallel with others.
- No phase publishes anything. Content phases produce drafts, e.g. `content/linkedin/post-01.md`, `content/email/welcome-1.md`.
- Many similar pieces of content go into one phase with `workPackages`, produced by the campaign plan (`from`, a YAML file). Usual package types: `post`, `email`, `landing-page`, `ad`, `article`; every type needs a builder and reviewers.
- Acceptance criteria are checkable: every claim has a source in the inputs or is marked as an assumption, every piece names its channel, audience and call to action, length limits of the channel are kept.
- Name outputs after their content (`positioning.md`, `campaign-plan.md`), not `report.md`.

## Build and review

Add these lines to every build and review task of the pipeline:

```
Plans and briefs in <docs>. Published copy (posts, emails, landing page, ads) in <ui>, written for the audience in docs/input/marketing-brief.md.
Never invent numbers, quotes, customer names or results. Every claim has a source in the inputs or is marked as an assumption.
Nothing is published, posted, sent or bought; you write drafts for a human to approve.
Keep the tone of voice from the brief and the length limits of each channel.
```

Add this line to every review task:

```
Check every claim against the inputs. An unsourced claim, a promise the offer cannot keep or copy in the wrong language is a blocking finding.
```
