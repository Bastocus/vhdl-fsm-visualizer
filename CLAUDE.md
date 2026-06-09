# VHDL FSM Visualizer — Project Guide

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
- Run parser tests: `npm test` (runs `test/run.ts` over `test/fixtures/*.vhd`, comparing against
  the `-- EXPECT from -> to | condition` headers). **Run this as a regression gate after any
  parser change.**
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

## Versioning
Before committing any changes, **increment the version in `package.json`**. Use semantic versioning:
- **Patch** (0.3.x): bug fixes, small improvements that don't change functionality.
- **Minor** (0.x.0): new features, phases of the roadmap (e.g., Phase 1 → 0.3.0, Phase 2 → 0.4.0).
- **Major** (x.0.0): breaking changes to the API or parser output format.

The version is used for VSIX packaging (`build-vsix.ps1`/`build-vsix.bat`), so each build
must have a distinct version to avoid conflicts when testing locally.
