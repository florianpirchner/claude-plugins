# Product vision: todo API

A tiny HTTP API for a personal todo list. It exists to test the expert-teams plugin end to end, so it stays deliberately small.

## What it does

- `GET /todos` lists all todos as JSON, oldest first.
- `POST /todos` with `{ "title": "..." }` creates a todo and answers `201` with it. A missing or empty title (after trimming) answers `400`.
- `PATCH /todos/:id` with `{ "done": true | false }` marks a todo done or open. An unknown id answers `404`.
- `DELETE /todos/:id` deletes a todo and answers `204`. An unknown id answers `404`.
- A todo is `{ "id": <number>, "title": <string>, "done": <boolean> }`. Ids start at 1 and are never reused.

## Limits

- Node.js 18 or later, no dependencies: `node:http` and `node:test` only.
- The todos live in memory; a restart empties the list.
- One file `src/server.js` exporting `createServer()`, tests in `test/`.
- `npm test` runs all tests and must pass.

## Not in scope

Users, login, persistence, a user interface, pagination.
