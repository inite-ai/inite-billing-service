---
name: spec-idea
description: Turn an idea for inite-billing-service into a filed GitHub issue with a short spec — no code. Use when someone just wants to propose something ("I'd like billing to…", "can we have…", "/spec-idea"), or when /contribute stops at a red zone.
---

# /spec-idea — propose without coding

Read AGENTS.md (repo root) for the zones and ground rules. Talk in plain
language; the person may not be an engineer.

1. Restate the idea in one or two sentences; ask at most 3 clarifying
   questions.
2. Search for duplicates: `gh issue list --search "<key words>" --state all`.
   If one exists, offer to comment on it instead.
3. Write the spec: **Problem**, **Behaviour** (what users/admins/integrating
   services see), **API / UI change**, **Data change**, **Risks** (money,
   auth, tenant scoping, `/v1` compatibility, PII), **Out of scope**, and the
   **Zone** from the AGENTS.md table.
4. Show it to the person and adjust until they agree.
5. File it with the *Product idea* form's fields (label `idea`):

   ```bash
   gh issue create --label idea --title "<short outcome>" --body-file <file>
   ```

   The body uses the form's headings: `### What do you want to be possible?`,
   `### Who is it for, and why?`, `### How would you know it works?`,
   `### Spec`. Write the body to a temp file first.
6. Give the person the issue URL and say what happens next: a maintainer
   reads it; red-zone ideas (payments, migrations, wallets, auth) need their
   approval before anyone writes code.

Do not create branches, edit files in the repo, or open PRs in this skill.
