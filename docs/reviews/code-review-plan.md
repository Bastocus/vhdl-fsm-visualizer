# Roadmap — Address Code-Review Findings (Testing Gaps & Blind Spots)

## Context

A code review of the VHDL FSM Diagram extension (report at
`docs/reviews/2026-07-01-testing-gaps.md`, branch `claude/code-review-testing-gaps-545i9m`)
found four issues plus large untested surfaces. Two are **silent correctness bugs**
(the parser emits wrong transitions with no error), one is a webview robustness/security
gap, and one is a missing-diagnostics UX gap. The parser has good fixture coverage for
*supported* constructs but nothing for these edge cases; `panel.ts` and `extension.ts`
have zero automated tests.

This roadmap breaks the fixes into standalone Claude Code sessions. Each phase follows
the project's own workflow (`CLAUDE.md`): add a fixture for every corner case, bump the
version in `package.json`, run `npm install && npm run compile && npm test`, and commit
only when green. Tests run via `tsx test/run.ts` (`npm test`); the runner compares parser
output against `-- EXPECT` header lines in each `test/fixtures/*.vhd`.

---

## Phase 1: Normalisation hardening — strip block comments and string literals

**Goal:** Stop VHDL-2008 block comments (`/* … */`) and string literals (`"…"`) from
being parsed as code, which today silently drops real transitions. This is the
highest-value fix — it corrects wrong output.

**Context for this session:**
- The parser is `src/parser.ts`, class `VhdlFsmParser`. The single entry point is
  `parse(source)`.
- `buildNormalised(source)` (`src/parser.ts:171`) currently lowercases each line and
  **space-pads only line comments** (`--` to end of line), preserving the invariant
  `normalised[i] === originalSource[i].toLowerCase()` for code chars. Every downstream
  regex runs on `this.normalised`, and display text is sliced from `this.originalSource`
  at the same offsets (`originalAt`, `src/parser.ts:919`). **Preserving character offsets
  is mandatory** — do not change string length when masking.
- Repro of the block-comment bug (currently emits only `a->b`, should emit all three):
  ```vhdl
  when a => s <= b; /* when b => end case */
  when b => s <= c;
  when c => s <= a;
  ```
  The `end case` inside the comment terminates the case early via `findMatchingEndCase`.

**Scope — what to implement:**
- In `buildNormalised`, add offset-preserving masking for:
  1. `/* … */` block comments — replace every non-newline char inside the span with a
     space, keep newlines so line numbers stay correct. Handle multi-line spans (the
     current per-line `split('\n').map(...)` structure must become span-aware; process
     the whole source in one pass or pre-mask before the per-line lowercase step).
  2. Double-quoted string literals `"…"` on code (non-comment) portions — replace inner
     chars with spaces. Respect VHDL's `""` escaped-quote (a doubled quote inside a
     string is a literal quote, not a terminator). Do **not** mask `--` or `/*` that
     appear *inside* a string, and do not mask quotes that appear inside a comment.
  3. Keep existing `--` line-comment handling; ensure precedence is correct (a `--`
     inside a string is not a comment; a `"` inside a `--` comment is not a string).
- Add fixtures under `test/fixtures/`:
  - `block_comment.vhd` — case arms separated by a `/* … */` containing `end case` /
    `when` keywords; `EXPECT` all arms' transitions.
  - `block_comment_multiline.vhd` — a multi-line `/* … */` spanning several arms.
  - `string_literal.vhd` — a `report "…"` (or assignment) whose string contains `;`,
    `=>`, `when others`, `end case`; `EXPECT` the surrounding real transitions.
- Bump minor version in `package.json` (new corner cases fixed), run
  `npm install && npm run compile && npm test`, commit when all 24+ fixtures pass.

**Out of scope:** VHDL nested/`/* */`-inside-`/* */` (VHDL block comments do not nest —
per LRM the first `*/` closes). Diagnostics for unterminated comments/strings (Phase 3).

**Done when:**
- The three new fixtures pass and all previously-green fixtures stay green (`npm test`
  → `0 failed`).
- The block-comment repro above emits `a->b`, `b->c`, `c->a`.
- `normalised.length === originalSource.length` still holds (spot-check: state lines and
  conditions still slice correctly in existing fixtures).

---

## Phase 2: Webview payload escaping + Content-Security-Policy

**Goal:** Make the webview robust against source text that breaks out of the inlined
`<script>` payload, and add the CSP that VS Code webviews are expected to carry.

**Context for this session:**
- `src/panel.ts`, class `FsmPanel`, method `_getHtml(fsms, title)` (`src/panel.ts:88`).
- Line 91 does `const fsmData = JSON.stringify(fsms);` and line 274 inlines it as
  `const FSM_DATA = ${fsmData};` inside a `<script>` block (opened at `src/panel.ts:267`).
- `JSON.stringify` does **not** escape `</script>` or `<!--`. Condition strings in
  `fsms[].transitions[].condition` are sliced verbatim from arbitrary VHDL source
  (`originalAt`), so a condition containing `</script>` closes the script element and the
  webview fails to render.
- The HTML `<head>` (`src/panel.ts:96`) currently has only `charset` and `viewport`
  meta tags — **no CSP**. There is an existing `escapeHtml` helper at `src/panel.ts:1213`.
- **Do not restyle the diagram** (CLAUDE.md invariant). This phase is additive: escaping
  + a meta tag only.

**Scope — what to implement:**
- Escape the JSON payload before inlining: after `JSON.stringify(fsms)`, replace
  `<` → `<` (and optionally `>` → `>`, `&` → `&`) so `</script>` /
  `<!--` can never appear literally. This is safe because it only changes the JS string
  encoding, not the parsed values.
- Add a CSP `<meta http-equiv="Content-Security-Policy" …>` to the `<head>`. Because the
  script and styles are inline, either (a) use a per-render nonce on the `<script>`/
  `<style>` tags (`nonce-${nonce}` in CSP + `nonce="${nonce}"` on the tags), or
  (b) if a nonce is too invasive for the inline styles, use a policy that permits the
  webview's own inline content while still restricting `default-src 'none'`,
  `img-src`/`style-src` as needed. Prefer the nonce approach for the script.
- Verify no regression to rendering by loading a fixture through the extension host, or
  at minimum by inspecting the generated HTML string in a small Node harness (the HTML
  is a pure function of `fsms`/`title`).

**Out of scope:** Broader webview refactors, message-passing changes, theming.

**Done when:**
- A parsed FSM whose condition text contains the literal `</script>` produces HTML where
  that substring appears only as `</script>` inside the payload (grep the generated
  string).
- The `<head>` contains a CSP meta tag and the diagram still renders unchanged
  (states, arrows, pills, selection glow/dim visually identical).
- `npm run compile` passes; version bumped (patch).

---

## Phase 3: Structural-error diagnostics for malformed input

**Goal:** Surface a clear error (instead of silently producing zero transitions) when the
parser hits an unterminated `case`/`if`, so users learn their file is truncated/malformed.

**Context for this session:**
- `src/parser.ts`. `findMatchingEndCase` (`src/parser.ts:815`) and `findMatchingEndIf`
  (`src/parser.ts:828`) return `-1` when no closing token is found. Today callers
  `continue`/fall back silently (e.g. `extractTransitions` at `src/parser.ts:278`,
  `parseStatements` at `src/parser.ts:484` and `:492`), so the file yields no FSM with
  `errors: []`.
- `ParseResult` already has an `errors: string[]` channel that is surfaced by the
  extension: `extension.ts:44/77/99` log `result.errors`, and `openDiagram`
  (`src/extension.ts:81`) shows an info message when `fsms.length === 0`.
- The test runner treats `result.errors.length > 0` as a fixture failure
  (`test/run.ts:105`), so error-emitting fixtures need a way to assert the *expected*
  error rather than fail.

**Scope — what to implement:**
- When `findMatchingEndCase`/`findMatchingEndIf` return `-1` at the top level (i.e. a
  genuinely unterminated construct, not a recoverable inner fallback), push a descriptive
  message onto `result.errors` (e.g. `Unterminated 'case' starting at line N`). Thread
  access to the `errors` array or return a status the driver in `parse()` can record.
  Be careful **not** to flag the intentional recoverable fallbacks (a nested `if`/`case`
  whose `end` is legitimately outside the current region uses `stop = end`) — only report
  when the construct is truly unclosed through end-of-source.
- Extend the test runner (`test/run.ts`) with an optional `-- EXPECT_ERROR <substring>`
  header: when present, assert `result.errors` contains a matching entry and do **not**
  treat the presence of errors as a failure for that fixture.
- Add fixture `unterminated_case.vhd` with `-- EXPECT_ERROR Unterminated` and no
  transitions.

**Out of scope:** Recovering/repairing malformed input; reporting warnings for
non-fatal oddities.

**Done when:**
- Parsing `process begin case s is when a => s <= b;` yields `result.errors` with an
  "Unterminated 'case'" message.
- `unterminated_case.vhd` passes via the new `EXPECT_ERROR` mechanism; all existing
  fixtures (which have no errors) still pass unchanged.
- Version bumped (minor); `npm test` green.

---

## Phase 4: Make webview/parser helpers unit-testable + fill thin-coverage fixtures

**Goal:** Close the "zero tests on `panel.ts`" gap for the pure logic, and add fixtures
for supported-but-thinly-tested parser paths.

**Context for this session:**
- `src/panel.ts` (1214 lines) has no tests. Its **pure, host-independent** helpers are
  the testable targets: `groupEdges` (edge de-dup/grouping), `escapeHtml`
  (`src/panel.ts:1213`), and the state-label line-wrapping logic (`src/panel.ts:817-836`).
  Most of `panel.ts` runs inside the webview and references `document`, so only extract
  what is genuinely pure.
- The current test harness is `test/run.ts` (fixture-based, parser-only) run via `tsx`
  with `tsconfig.test.json`. There is **no** unit-test harness yet.
- Thin parser coverage identified in the review: `xor/nand/nor/xnor` precedence
  (`negate`/`hasTopLevelLowPrecOp`, `src/parser.ts:857/901` — only `or` is tested via
  `or_and_precedence.vhd`); `with … select` combined with `when others` that must
  subtract range-covered states (`parseSelectedAssign`, `src/parser.ts:303`); and
  transition de-dup (`emit`, `src/parser.ts:755`).

**Scope — what to implement:**
- Extract the pure helpers (`groupEdges`, `escapeHtml`, label-wrap) into a small module
  importable by tests without a VS Code/DOM host — e.g. `src/panelHelpers.ts` — and have
  `panel.ts` import them (keep behaviour identical; no restyle). If extraction is too
  invasive for the webview-inlined code, instead copy the pure functions into a tested
  module and reference from both, documenting the shared source.
- Add a lightweight unit-test file (e.g. `test/unit.ts`, run via `tsx`) with a matching
  `npm run` script, asserting: `escapeHtml` escapes `& < > "`; `groupEdges` merges
  parallel edges and de-dups; label-wrap splits long state names as the diagram expects.
- Add parser fixtures: `xor_precedence.vhd` (mixed `and`/`xor`/`nand`),
  `selected_others_range.vhd` (`with select` + `when others` after a `to`/`downto`
  range), and `dedup.vhd` (same transition reachable two ways, expect one edge).
- Bump version (minor); ensure both `npm test` and the new unit script pass; wire the
  unit script into the pre-commit verify flow noted in `CLAUDE.md`.

**Out of scope:** Rendering/DOM/integration tests of the actual webview, `extension.ts`
activation tests (needs a VS Code test host — track separately), visual styling changes.

**Done when:**
- A new unit-test command passes and covers `escapeHtml`, `groupEdges`, and label-wrap.
- The three new parser fixtures pass; all prior fixtures stay green.
- `npm run compile` passes and `panel.ts` behaviour is unchanged (diagram renders
  identically).

---

## Summary table

| Phase | Title | Model | Effort | Key deliverable |
|-------|-------|-------|--------|-----------------|
| 1 | Normalisation: strip block comments + string literals | Opus | high | Offset-preserving masking in `buildNormalised` + 3 fixtures; fixes silent dropped transitions |
| 2 | Webview payload escaping + CSP | Sonnet | medium | `</script>`-safe JSON payload and CSP meta in `_getHtml`, no restyle |
| 3 | Structural-error diagnostics for malformed input | Sonnet | medium | `errors[]` populated for unterminated `case`/`if` + `EXPECT_ERROR` runner support + fixture |
| 4 | Unit-testable helpers + thin-coverage fixtures | Sonnet | medium | `panelHelpers` unit tests + `xor`/`with-select-others`/dedup fixtures |

**Sequencing note:** Phase 1 is independent and highest-value (do first). Phases 2–4 are
mutually independent and can be done in any order or parallel sessions. Phase 1 uses Opus
because the offset-preserving multi-pass masking (comment/string precedence, `""` escapes)
is subtle and a mistake silently corrupts every downstream offset.

**Verification (all phases):** `npm install && npm run compile && npm test` must pass
before each commit (per `CLAUDE.md`). For Phase 2, additionally grep the generated HTML
string for escaped `</script>` and confirm the CSP meta tag is present; ideally load a
fixture in the Extension Development Host and confirm the diagram renders unchanged.
