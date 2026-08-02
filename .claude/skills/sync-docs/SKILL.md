---
name: sync-docs
description: >-
  Use when preparing a pull request in Write-Wall (the pre-PR gate — run it right
  before `gh pr create` so doc updates ride in the same PR), before tagging a
  release, or whenever the docs feel stale. Also use after changes to storage
  keys, quota/threshold constants, package.json scripts, src module layout,
  manifest.json, or CI workflows — those are the surfaces docs quote. Invoke
  with /sync-docs.
---

# sync-docs

Keep the docs true to the code and free of bloat. This is a **docs-only** skill: it never
changes application code, only Markdown. Each run is a diff-and-reconcile pass, not a
rewrite.

Ad-hoc greps for values your own change touched are necessary but not sufficient — the
gaps this skill exists to close are the ones nobody greps for: the Tier-3 docs
(`docs/*.md`), `README.md`, the reverse direction (documented claims whose code moved in
an *earlier* PR), shipped plan/spec retirement, and the edit boundary. Work the whole
procedure, not just the drift you already know about.

## Scope guard — read this first

- **Only git-tracked Markdown is in scope.** `git ls-files '*.md'` is the universe
  (~17 files). Untracked Markdown (anything under a gitignored path, local scratch) is
  never a source of truth and never deleted.
- **`dist/` is generated output** — nothing in it is ever edited, doc or otherwise.
- **Never quote counts that rot.** Test totals, line counts, and coverage percentages
  change every commit; docs own *names, keys, commands, and limits*, not tallies.

## The doc-ownership map (an allowlist — sync-docs may edit ONLY these)

### Tier 1–2: front door and agent contract

| File | Owns | Rule |
|------|------|------|
| `README.md` | Human front door: what Write Wall is, install (Web Store + unpacked), usage, screenshots, contributing pointer. | Keep short; user-facing tone. No agent contract material. |
| `AGENTS.md` | Universal agent contract: overview, tech stack, repository layout, where-to-add-code table, dev workflow, scripts, critical constraints, common pitfalls, commit/PR policy. | Budget **< 150 lines** (`wc -l`, don't trust a written number). New material must displace something or move to `docs/*.md`. |
| `CLAUDE.md` | Claude-specific extensions: architecture quick reference (modules, storage keys, throttle), code patterns, debugging playbook, CI/CD notes. Imports `AGENTS.md` via `@AGENTS.md` — never restate AGENTS content. | Budget **< 95 lines**. |
| `docs/KNOWLEDGE_BASE.md` | Tier-2 table of contents: 1–2 line summary + pointer per Tier-3 doc, plus the sync marker (last line). | Budget **< 100 lines**. Every pointer must resolve. |

### Tier 3: deep dives

| File | Owns |
|------|------|
| `docs/architecture.md` | System shape: extension pages, sync format (sharding, `v2`/`v2x_*`/`v2m`), SyncStore behavior, editor rendering model, data flow. |
| `docs/development.md` | Dev workflow detail: nave/corepack setup, watch mode, loading unpacked, release/publish flow. |
| `docs/troubleshooting.md` | Symptom → cause → fix, including sync-quota and mixed-version behaviors. |

### Factual-drift-only (edit facts, never restructure)

`CONTRIBUTING.md` (setup commands, branch/PR policy), `SECURITY.md` (supported versions,
contact). Fix a command or version that moved; leave voice and structure alone.

### Transient — retire once shipped (procedure step 4)

`docs/superpowers/plans/*.md`, `docs/superpowers/specs/*.md` — dated design/plan docs
(`YYYY-MM-DD-<slug>.md`). Once the work has shipped and the durable *what/why* lives in
the owning Tier-3 doc, delete the file. **Cap: 3 retirements per run**, oldest first.

### Report-only — never edit (default-deny catches everything unnamed too)

- `CHANGELOG.md` — append-only, owned by the release flow. A sync pass never rewrites
  history; if an entry is factually wrong, report it.
- `CODE_OF_CONDUCT.md` — standard text, not project documentation.
- `.github/PULL_REQUEST_TEMPLATE.md`, `.github/ISSUE_TEMPLATE/*.md` — consumed by
  GitHub's UI; changing them changes a workflow surface, which is its own reviewed change.
- `.design-sync/*.md` — DesignSync tool state, machine-owned.
- `.claude/skills/**` — agent instructions, not project docs (this file excepted, and
  only for skill maintenance, never during a sync pass).

**Anything not named in this map is unowned**: report the drift and propose an owner;
do not silently adopt or edit it.

## Extract the code truth (the surfaces docs quote)

Run from the repo root. `# →` comments show the shape, not a number to trust — recount.

```bash
# Version parity + values (package.json is source of truth, manifest must match)
pnpm verify-version && grep '"version"' package.json public/manifest.json

# Command surface (AGENTS.md "Scripts" section must match exactly, both directions)
node -e "console.log(Object.keys(require('./package.json').scripts).join('\n'))"

# Module inventory (AGENTS.md Repository Layout + where-to-add-code; CLAUDE.md quick ref)
git ls-files 'src/*.ts' | grep -v '\.spec\.ts$'
git ls-files 'src/test/*.ts'

# Storage keys — sync (docs quote these names verbatim)
grep -n "HEAD_KEY\|CHUNK_KEY_PREFIX\|META_KEY\|LEGACY_KEY" src/sync_format.ts | head -4
# Storage keys — local
grep -n "_KEY = '\|BACKUP_KEYS" src/main.ts src/sync_store.ts

# Quotas, thresholds, throttles (the highest-drift documented values)
grep -n "ITEM_QUOTA_BYTES\|SYNC_QUOTA_BYTES\|ITEM_MARGIN_BYTES\|TOTAL_RESERVE_BYTES\|MAX_CHUNKS" src/sync_format.ts
grep -n "NEAR_LIMIT_PCT\|CHANGE_DELAY\|IMMEDIATE_FLUSH_GUARD_MS\|BACKUP_MIRROR_MS" src/main.ts | head -6

# Manifest surface (permissions and MV3 keys docs mention)
grep -E '"(permissions|manifest_version|background|action)"' public/manifest.json

# Toolchain pins (README/AGENTS/CONTRIBUTING quote these)
cat .naverc && grep '"packageManager"' package.json

# CI workflows (CLAUDE.md CI/CD notes)
ls .github/workflows
```

A negative grep is the easiest way to manufacture a false finding — before concluding
"docs reference something that doesn't exist", re-check with `git grep` across all of
`src/`.

## Procedure

1. **Scope.** Pre-PR gate (the normal case): `git diff --stat $(git merge-base main HEAD)..HEAD`
   tells you which surfaces moved → which docs to open. Periodic run: read the sync
   marker at the bottom of `docs/KNOWLEDGE_BASE.md`
   (`<!-- docs-synced-through: <sha> (<date>) -->`) and diff from there; if absent, this
   is the first run — reconcile everything and add it.
2. **Reconcile every doc the map ties to a moved surface — and always sweep Tier 1–2.**
   Both directions: every doc claim still matches code, every new code surface at
   documenting altitude appears. High-drift spots: storage-key lists, quota/threshold
   numbers, the scripts table, module lists, the throttle description, manifest
   permissions. Prune as you go: kill cross-tier duplicates (owning doc keeps it, other
   gets a pointer), delete shipped TODOs and dead caveats.
3. **Check budgets:** `wc -l AGENTS.md CLAUDE.md docs/KNOWLEDGE_BASE.md` against
   150 / 95 / 100. Over budget → move a section down a tier in the same pass.
4. **Retire shipped plan/spec docs** (max 3, oldest first):
   `git ls-files 'docs/superpowers/**/*.md'`. Confirm shipped against the code truth;
   fold durable content into the owning doc; delete. Unsure → leave it, list as
   unresolved.
5. **Fix pointers.** `docs/KNOWLEDGE_BASE.md` TOC, README links, and any inbound
   references to files you deleted:
   `git ls-files '*.md' | xargs grep -n "superpowers/"`.
6. **Stamp the marker.** Edit `docs/KNOWLEDGE_BASE.md`'s last line to
   `<!-- docs-synced-through: <short-sha> (<YYYY-MM-DD>) -->` using the current HEAD,
   then confirm: `tail -1 docs/KNOWLEDGE_BASE.md | grep -q docs-synced-through`.
7. **Verify.**
   ```bash
   # (a) Docs-only and allowlist-only. Anything else printed = revert it.
   git diff --name-only HEAD | grep -vE '\.md$' && echo "STOP: non-Markdown changed"
   git diff --name-only HEAD | while read -r f; do
     case "$f" in
       README.md|AGENTS.md|CLAUDE.md|CONTRIBUTING.md|SECURITY.md) continue;;
       docs/KNOWLEDGE_BASE.md|docs/architecture.md) continue;;
       docs/development.md|docs/troubleshooting.md) continue;;
       docs/superpowers/plans/*.md|docs/superpowers/specs/*.md) continue;;
     esac
     echo "STOP: $f is not in the ownership map"
   done

   # (b) No dangling relative links or backticked path citations.
   git ls-files '*.md' | grep -vE '^docs/superpowers/|^\.design-sync/' | while read -r f; do
     grep -oE '\]\(([^)#]+)' "$f" | sed 's/](//' | while read -r t; do
       case "$t" in http*|mailto*|/*) continue;; esac
       [ -e "$(dirname "$f")/$t" ] || echo "DANGLING: $f -> $t"
     done
     grep -ohE '`(src|docs|public|scripts)/[A-Za-z0-9_./-]+`' "$f" | tr -d '`' \
       | while read -r p; do [ -e "$p" ] || echo "BROKEN CITATION: $f -> $p"; done
   done
   ```
   Checks report pre-existing breakage too — fix what your change caused, list the rest
   as `Unresolved:`. Do not run the code test suite for a docs-only pass; the one
   exception is a changed documented command, which you run once to confirm.
8. **Commit in the right place, then report.**
   - **Pre-PR-gate run** (on an existing feature branch): commit onto that same branch —
     the doc updates ride in the PR you are about to open. No second branch, no second PR.
   - **Periodic run** (from `main`): create a `docs/…` branch and open its own PR.
   - Always: `git commit --signoff` + Conventional Commits (`docs: …`) + the
     `Co-Authored-By` trailer if the repo's commit convention requires it. PRs target
     **`main`, never `master`** — git metadata in this repo misreports the default
     branch; do not trust it over this rule.
   - Report: `Corrected: … | Retired: N (M remain) | Budgets: AGENTS n/150, CLAUDE n/95, KB n/100 | Marker: <sha> | Unresolved: …`

## When NOT to change something

- **Load-bearing pins**: `.naverc` (`lts`), `packageManager` in package.json, the
  8,192/102,400-byte quota values — docs must *match* them, never "round" or reword them.
- **The truncation-marker string** quoted in docs — it is a wire-format constant
  (`MARKER` in `src/sync_format.ts`); docs must quote it exactly or not at all.
- **CHANGELOG history and dated plan/spec content** — records of what was true then.
  Retire whole files per step 4; never "correct" their contents.
- **Deliberate gap notes** (e.g. documented orphan-chunk-until-GC behavior, stale-client
  truncated view) — these describe real behavior, not staleness. Remove only when the
  underlying behavior changes.
