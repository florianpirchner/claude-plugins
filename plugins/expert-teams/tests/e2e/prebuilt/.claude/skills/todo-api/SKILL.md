---
name: todo-api
description: Runs the pipeline todo-api (Tiny in-memory todo HTTP API, from requirements to acceptance.). Only on explicit invocation.
argument-hint: "[status | <phase-id>] [--autonomous | --as-needed | --always]"
disable-model-invocation: true
---

# Pipeline todo-api

`/expert-teams:create` from the plugin `expert-teams` generated this file. It is only a shortcut: the pipeline lives in `.claude/expert-teams/pipelines/todo-api.yaml`, the procedure in the plugin's `expert-teams:run` skill.

Argument: `$ARGUMENTS`

Use the Skill tool to invoke the skill `expert-teams:run` with exactly `todo-api` as the argument, followed by a space and the argument above if it is not empty. Do not change the argument and do not add anything. If you cannot find the skill, tell the user that the plugin `expert-teams` must be installed and enabled, and stop.
