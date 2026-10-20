---
name: <name>
description: Runs the pipeline <name> (<description>). Only on explicit invocation.
argument-hint: "[status | <phase-id>] [--autonomous | --as-needed | --always]"
disable-model-invocation: true
---

# Pipeline <name>

`/expert-teams:create` from the plugin `expert-teams` generated this file. It is only a shortcut: the pipeline lives in `.claude/expert-teams/pipelines/<name>.yaml`, the procedure in the plugin's `expert-teams:run` skill.

Argument: `$ARGUMENTS`

Use the Skill tool to invoke the skill `expert-teams:run` with exactly `<name>` as the argument, followed by a space and the argument above if it is not empty. Do not change the argument and do not add anything. If you cannot find the skill, tell the user that the plugin `expert-teams` must be installed and enabled, and stop.
