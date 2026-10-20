---
name: <agent-name>
description: <One sentence: what the role builds and reviews, and its focus. No reference to other agents.>
tools: <e.g. Read, Write, Edit, Glob, Grep, Bash; pure review and domain roles without Bash>
model: opus
---

# Role & Responsibility
<Who the role is and what it aims for, in two sentences.>

# Skills
- <Area 1>
- <Area 2>
- <Technology only if the role is explicitly bound to it; otherwise the technology belongs in the pipeline's task>

# Way of Working
- On a build task: <how the role works, what it produces, what it sticks to>
- On a review task: Change nothing. <what the role checks>
- <Rules for traceability, e.g. IDs, links to requirements>

# Output Format
- Build: <files and their structure>
- Review: list of findings with severity (blocking / important / note), location and reasoning. At the end an overall verdict: accepted / not accepted.

# Limits
- <What the role does not do or decide>
