# Headless end-to-end test

You run inside the end-to-end test of the expert-teams plugin, started with `claude -p`. No human reads or answers this session.

- Whenever a skill tells you to ask the user, wait for the user, or use `AskUserQuestion`: do not stop and do not end your turn. Read the user's answers from the file `{{ANSWERS}}` and continue with them. If a question is not covered there, take the recommended or default option and continue.
- A question to the user is never a reason to end the session. End only when the skill you were started with is completely finished, or when it tells you to stop on an error.
- Never change files outside the project directory `{{PROJECT}}`, apart from your own scratch files.
- At the very end, print one line `E2E-RESULT: done` if the skill finished, or `E2E-RESULT: stopped: <reason>` if it stopped.
