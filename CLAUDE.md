# VHDL FSM Diagram — Project Guide

VS Code extension that detects finite state machines in VHDL and renders an interactive SVG
diagram. Source files in `src/` folder (no build step needed to read them).

**For detailed specification, architecture design, and phased roadmap, see [`docs/SPEC_AND_ARCHITECTURE.md`](../docs/SPEC_AND_ARCHITECTURE.md).**

## Architecture
- `src/parser.ts` — `VhdlFsmParser.parse(source)` → `ParseResult { fsms, errors }`. Core logic:
  normalise source (lowercase + comment-pad to preserve char offsets), extract enum types,
  group FSM signals **by enum type**, then for each `case <selector> is` recursively parse the
  arm bodies (`parseStatements`) into `FsmTransition { from, to, condition, line }`.
- `src/panel.ts` — `FsmPanel` builds the webview HTML: circular layout, SVG edges/states, the
  click-to-select glow/dim overlay, the `...` condition pills + tooltip, and the Transitions table.
- `src/extension.ts` — VS Code activation, `showDiagram` command, auto-refresh on save.

## Key invariants / gotchas
- Normalisation pads comments with spaces so `normalised[i]` aligns with `originalSource[i]`;
  always slice display text (case-preserving) from `originalSource` at matched offsets.
- FSMs are keyed by enum **type**, not signal — supports two-process (`current_state`/`next_state`).
- Conditions are full AND-chains with explicit negation for `elsif`/`else`.
- `when others` / `when s1 | s2` expand to one transition per concrete state (no pseudo-nodes).
- **Do not restyle** the diagram (states, arrows, `...` pills, selection glow/dim) — the look is
  intentional. UI additions must be additive.

## Build & test
- `tsconfig.json` uses `rootDir: ./src` with TypeScript sources in `src/`. Main build: `npm run compile`. Tests use `tsconfig.test.json` + `tsx`.
- **Automated before every commit** (see Versioning & commit workflow): compile + test verify correctness.
- Add a fixture for every new corner case before/while fixing it.

## Testing strategy
Each phase includes:
1. **New fixtures** for the corner cases that phase fixes (e.g., Phase 1 adds `nested_if.vhd`,
   `nested_case.vhd`).
2. **Implementation tests** — run `npm test` at the end of the phase to verify the new fixtures
   pass.
3. **Regression tests** — `npm test` also verifies that **all previously-passing fixtures still
   pass** (the runner compares against the KNOWN_FAILS list, which shrinks as phases land).
   No prior phase's work should break.

A phase is only "done" when `npm test` runs all fixtures (old and new), previously-green ones
stay green, and the phase's own new ones turn green (removed from KNOWN_FAILS).

This protects against accidental regressions in a large refactor (especially Phase 1's recursive
parser rewrite).

## Versioning & commit workflow
Before each commit, the assistant should:
1. **Bump the version** in `package.json` using semantic versioning:
   - **Patch** (0.3.x): bug fixes, small improvements that don't change functionality.
   - **Minor** (0.x.0): new features, phases of the roadmap (e.g., Phase 1 → 0.3.0, Phase 2 → 0.4.0).
   - **Major** (x.0.0): breaking changes to the API or parser output format.
2. **Build & verify**:
   - `npm install` (sync `package-lock.json` with the version bump)
   - `npm run compile` (verify TypeScript compiles without errors)
   - `npm test` (run regression suite; all previously-passing fixtures must stay green)
3. **Commit** once all checks pass. If any check fails, fix the issue before committing.

## Packaging (.vscodeignore)
The VSIX must **not** include source (`src/`, `test/`, `docs/`), build configs, or `.claude/`
(local settings may contain secrets) — only `LICENSE`, `README.md`, `media/`, `out/*.js`, and
`package.json`. Keep `.vscodeignore` up to date and spot-check with `npx vsce ls` after changes
to packaging-related files.

## Releasing to GitHub
Releases are handled entirely by the GitHub Actions workflow at `.github/workflows/release.yml`.
No local VSIX build is needed.

**CRITICAL: Never trigger a release autonomously.** Only create a release when the user explicitly
asks for it (e.g., "release version X", "publish a new release"). Do not trigger a release as a
side-effect of implementing a feature or bug fix.

### Steps
1. **Bump the version** in `package.json`, run compile + test, commit and push to `main`.
2. **Trigger the release workflow** — two options:
   - **From the GitHub Actions UI**: go to Actions → "Release" → "Run workflow", enter the tag
     (e.g. `v1.0.3`) and release title, click Run.
   - **Via the Claude Code MCP tool** (`mcp__github__actions_run_trigger`):
     ```
     method: run_workflow
     workflow_id: release.yml
     ref: main
     inputs: { tag: "v1.0.3", title: "v1.0.3 — Description" }
     ```
3. The workflow checks out `main`, runs `npm ci`, builds the VSIX with `npx vsce package`,
   creates a GitHub release with the tag, and uploads the `.vsix` as an asset automatically.
4. **Verify** the release at `https://github.com/Bastocus/vhdl-fsm-diagram/releases`.

### Workflow file: `.github/workflows/release.yml`
The workflow is triggered by `workflow_dispatch` only (never runs automatically on push),
so it cannot accidentally create a release from a work-in-progress commit.
