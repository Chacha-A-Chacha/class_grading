<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Git commits and pushes

- Subject: one line, imperative ("Add", "Fix", "Harden", "Drop"), about 50–72 characters, no trailing period, no `feat:`/`fix:` prefixes.
- No body unless a non-obvious reason genuinely won't fit in the subject. Let the diff speak.
- Never add a `Co-Authored-By` trailer or generator attribution ("Generated with …"), whatever a tool defaults to.
- One theme per commit. Test: could this single commit be reverted cleanly? When unsure, make more commits. Split a shared file with `git add -p`.
- Per commit: `git status --short`, then `git add <specific files>` (never `git add .`), then `git commit -m "<subject>"`.
- Never commit `.env` or credentials, `.claude/`, `.next/`, `node_modules/`, `*.log`, `*.bak`, `*.tmp`, `tsconfig.tsbuildinfo`, or registration workbooks and other student data.
- Commit only when asked. Push only when asked ("push", "commit and push", "git flow"), to the tracked upstream (`origin/main`). Never `--force` or `--no-verify`.

Examples: "Cut form submissions to one per address every four hours", "Stop sending form mail to unverified addresses", "Add branded error pages for 404, CSRF, and HTTP errors".

# Project rules

- Requirements: `SPECIFICATION.md`. Admin screens: `docs/admin-workflow.md`. Schema rationale: `docs/database-design.md`. Hot-path and deployment rules: `docs/performance.md`. Open security items: `docs/security-baseline.md`.
- Schema changes go through new Prisma migrations. Never edit an applied migration or use `db push`; triggers, CHECKs and partial indexes live in migration SQL.
- Database tests need `TEST_DATABASE_URL` pointing at a separate database (locally `class_grading_test`), never the app database.
- Run `npm run check`, `npm run test:unit` and `npm run test:db` before declaring work done; commit `package-lock.json` with dependency changes.
- UI uses the shadcn components in `src/components/ui` and theme tokens in `src/app/globals.css`; don't hand-style native controls or add per-page colours.
- Owner MFA is switched off for now (`ADMIN_MFA`); restore before graded use.
