@AGENTS.md

## Claude Code only

- `/contribute` (`.claude/skills/contribute/`) runs the idea → spec → PR loop
  from AGENTS.md with a non-engineer; `/spec-idea` (`.claude/skills/spec-idea/`)
  only turns an idea into a filed *Product idea* issue, no code.
- Machine-local permission grants go in `.claude/settings.local.json`
  (gitignored) — never commit it.
- `npm test` starts Docker containers (`scripts/test.sh`); ask before running
  it. Without a database, run the DB-free gates and let CI run the rest.
