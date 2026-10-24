@AGENTS.md

## Claude Code only

- Claude Code plans and reviews. Codex or pi may build, so plans must work with no chat history.
- Skills: `/task-scan`, `/part-plan NN`, `/part-build NN`, `/part-review NN`, `/final-check`.
- When I correct you, add one line to `.task/ai-mistakes.md`: what you got wrong and how I noticed.
- At the end of each session, I run `/export` into `ai-logs/`.
