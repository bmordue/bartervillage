# Agent workflow

- Commit after completing each checklist task. Include the checklist update in the same commit.
- Before committing, run `npm run lint`, `npm run format:check`, `npm run typecheck` and `npm test`.
- After editing `IMPLEMENTATION_CHECKLIST.md`, run `python3 scripts/check-checklist-deps.py`.
- Follow the existing commit style: task IDs, then a short description.
- Do not use emojis.

## Project map

- `packages/rules`: pure rules/types (`engine.ts`, `types.ts`, `barter.ts`, `orders.ts`, `help.ts`).
- `packages/server`: Node API. `src/api.ts` is large (~950 lines); auth in `src/auth/`, persistence in `src/db/`.
- `packages/client`: Preact UI (`app.tsx`, `panels.tsx`, `plotView.tsx`).
- Tests: `<package>/test/*.unit.test.ts`. Run one with `npx vitest run --project unit <file>`.

## Taking a new task

- Check `gh issue list --repo bmordue/bartervillage --state open` for the next item with no blockers.
- Work on a fresh branch named after the task ID (e.g. `M9.02-deploy-vps`).
- Raise a PR linked to the issue, referencing the task ID in the commit message and PR title.
- Follow the commit style: task IDs, then a short description.

## Token discipline

- Never attach, print or re-read the whole `IMPLEMENTATION_CHECKLIST.md`. Find the next task with:
  `rg -n '^\s*- \[ \]' IMPLEMENTATION_CHECKLIST.md | head -3`
  Read only that line plus its task section if needed. Task lines contain their dependencies.
- Locate before reading: `rg -n '<symbol>' <dir>` first, then read only the surrounding 40-80 lines. Do not `cat` files over ~150 lines.
- Do not `cat` several files to understand structure; use `rg -l` or `rg -n` and targeted reads.
- Never re-read a file already in context. After editing, use `git diff -- <path>`.
- Cap exploratory output: `head -50`, `git log -5`, `git show --stat`. No repo-wide `rg` without `-l`/`-n` and a limit.
- During iteration run only the affected test file. Run the full suite once immediately before committing; on failure rerun only the failing check.
- Use an `explore` subagent for open-ended "where/how does X work" searches so raw results stay out of the main context.
- Keep reasoning brief. Do not restate file contents, the checklist or tool output in reasoning or replies.