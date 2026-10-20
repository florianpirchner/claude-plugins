# Scripted answers for /expert-teams:create

The end-to-end test has no human. These are the user's answers. When the skill asks something that is listed here, answer with it. When it asks something that is not listed, take the recommended or default option. When it asks whether a stage is finished or whether to move on, the answer is yes.

## Stage 1: Brainstorming

- The idea: build the todo API described in `docs/input/product-vision.md`, exactly as written there.
- Users: just me, through `curl` or tests.
- Most important: the four endpoints work as described and are covered by tests.
- Explicitly out: everything in "Not in scope".
- Basis: `docs/input/product-vision.md`, no existing code.
- I am done telling.

## Stage 2: Grill me

- Technology: fixed idea. Node.js 18 or later, plain JavaScript (ES modules), `node:http` and `node:test`, no dependencies.
- Open points: the vision is the answer. If something is not in it, choose the simplest behaviour and record it as an assumption.
- Base questions, confirm this list:
  1. Language: code `en`, docs `en`, ui `en`.
  2. Delivery: `commit` (there is no GitHub here).
  3. Target branch: `main`. Integration branch: the default `expert-teams/todo-api`.
  4. Check before every commit in code phases: `npm test`.
  5. Worktrees: `true`, at most 2 agents in parallel.
  6. Checkpoints: `true`.
  7. Review rounds: 2.
  8. Models: Opus.
  9. Human in the loop: `autonomous`.
  10. Consult questions: on, at most 2 per role and round.

## Stage 3: Team

Exactly three roles, all new: `product-manager` (requirements), `backend-developer` (code and its tests), `tester` (reviews requirements and code). No other roles.

## Stage 4: Flow

Exactly three phases, one after the other:

1. `requirements`: product-manager builds `docs/specification/requirements.md` (numbered requirements with acceptance criteria), tester reviews it.
2. `implementation`: code phase. backend-developer builds `src/server.js` and `test/server.test.js`, tester reviews. Acceptance: `npm test` passes and every requirement has a test.
3. `acceptance`: tester builds `docs/acceptance/report.md` (each requirement with the test that covers it and the result of `npm test`), product-manager reviews.

## Stage 5: Generate

- Name: `todo-api`.
- Commit the created files: yes, one commit on `main`.
