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
- **Automated before every commit** (see Versioning & commit workflow): compile + test verify correctness.
- Add a fixture for every new corner case before/while fixing it.

### Manual VSIX builds (for local testing)
Use `build-vsix.ps1` (PowerShell) or `build-vsix.bat` (Command Prompt) to package the extension locally:
```powershell
.\build-vsix.ps1
```
This creates a `.vsix` file you can install in VS Code via **Extensions → Install from VSIX**. Version in `package.json` determines the VSIX filename, so test against the latest version.

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

The version is also used for VSIX packaging (`build-vsix.ps1`/`build-vsix.bat`), so
each distinct build must have a new version to avoid conflicts when testing locally.

## Releasing to GitHub
When ready to release a new version:
1. **Create a GitHub release** with tag `vX.Y.Z` matching the version in `package.json`
2. **Build the VSIX**: `npx vsce package` (creates `vhdl-fsm-visualizer-X.Y.Z.vsix`)
3. **Upload the VSIX** to the GitHub release as an asset using the API:
   ```bash
   # Get the GitHub token from ~/.claude/settings.json (GITHUB_TOKEN field)
   # POST to https://uploads.github.com/repos/Bastocus/vhdl-fsm-visualizer/releases/{release_id}/assets
   # Use --data-binary (NOT -d @filename) for binary uploads
   curl -X POST -H "Authorization: token $TOKEN" \
     -H "Content-Type: application/octet-stream" \
     --data-binary "@vhdl-fsm-visualizer-X.Y.Z.vsix" \
     "https://uploads.github.com/repos/Bastocus/vhdl-fsm-visualizer/releases/{release_id}/assets?name=vhdl-fsm-visualizer-X.Y.Z.vsix"
   ```
4. **Verify the upload** by downloading and comparing SHA256:
   - Calculate local SHA256: `sha256sum vhdl-fsm-visualizer-X.Y.Z.vsix`
   - Download from release and verify SHA256 matches
   - Confirm VSIX is a valid ZIP: `unzip -t vhdl-fsm-visualizer-X.Y.Z.vsix` (should report "No errors detected")
   
   If checksums don't match, delete the asset and re-upload with `--data-binary`.

**CRITICAL**: Always verify the upload integrity before announcing the release. A corrupted
VSIX can't be installed by users, and GitHub doesn't catch this automatically.
