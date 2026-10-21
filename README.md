# claude-plugins

Flo's Claude Code plugins. This repository is a plugin marketplace and holds the plugins at the same time.

## Installation

```
/plugin marketplace add florianpirchner/claude-plugins
/plugin install <plugin-name>@florianpirchner
```

## Plugins

| Plugin | What it does |
|---|---|
| [expert-teams](plugins/expert-teams) | Guided design, change and execution of builder/challenger pipelines with subagents, for software, marketing, research and docs: `/expert-teams:create`, `/expert-teams:modify`, `/expert-teams:run`, `/expert-teams:status`, `/expert-teams:migrate`. |

## Structure

```
.claude-plugin/marketplace.json   marketplace with one entry per plugin
plugins/<name>/
├── .claude-plugin/plugin.json    manifest (name, version, description)
├── skills/                       skills of the plugin
├── README.md
└── LICENSE
```

## Rules

- A plugin's `name` never changes after it is published, because installations depend on it. If a rename is unavoidable, add it to `renames` in `.claude-plugin/marketplace.json`.
- Raise `version` in `plugin.json` with every change, otherwise installations do not get the update.
