# Code Review — Blind Spots & Testing Gaps

**Date:** 2026-07-01
**Scope:** `src/parser.ts`, `src/panel.ts`, `src/extension.ts`, `test/`
**Baseline:** `main` @ `7e7d93f`. All 24 fixtures pass (`npm test` → `24 passed, 0 failed`).

The parser test suite is solid for the *supported* VHDL constructs — every phase's
corner case has a fixture and the regression runner enforces both missing- and
extra-transition checks. The gaps below are things the current fixtures don't
exercise and, in two cases, produce **silently wrong output**.

---

## Findings (ranked by severity)

### 1. Block comments (`/* … */`, VHDL-2008) are not stripped → dropped transitions
**Severity: High (correctness) · Confirmed**

`buildNormalised` (`src/parser.ts:171`) only handles line comments (`--`). VHDL-2008
delimited comments (`/* … */`) pass through untouched, so any keyword inside a block
comment is parsed as real code and corrupts arm-splitting.

Repro:
```vhdl
type st is (a,b,c); signal s: st;
process begin case s is
  when a => s <= b; /* when b => end case */
  when b => s <= c;
  when c => s <= a;
end case; end process;
```
Expected: `a->b, b->c, c->a`. **Actual: only `a->b`** — the `end case` inside the
comment terminates the case early and the last two arms vanish. No error is raised.

**Fix direction:** extend `buildNormalised` to space-pad `/* … */` spans (same
offset-preserving strategy already used for `--`). **No fixture covers block comments.**

---

### 2. String literals are not stripped → potential arm corruption
**Severity: Medium (correctness) · Partially mitigated**

Condition/label text is sliced from source without removing string literals
(`"…"`). Today `isArmStartWhen` (`src/parser.ts:802`) accidentally shields the most
common case (a `when` inside a `report "…"` string isn't preceded by `;`/`is`), so
`report "x => y when others"` happens to parse correctly. But a string containing a
statement-terminating `;` followed by `when`/`end case`, or a `=>`, is not defended
against and can still mis-split arms. **No fixture exercises string literals** — the
current pass is incidental, not guaranteed.

**Fix direction:** strip/space-pad string literals during normalisation alongside
comments.

---

### 3. `JSON.stringify(fsms)` embedded in `<script>` with no `</script>` escaping / no CSP
**Severity: Medium (robustness/security) · Confirmed by inspection**

`src/panel.ts:91` inlines `JSON.stringify(fsms)` directly into a `<script>` block
(`src/panel.ts:274`). `JSON.stringify` does **not** escape `</script>`. Condition
strings are sliced verbatim from arbitrary source (`originalAt`), so a condition
containing the literal `</script>` (or `<!--`) breaks out of the script element and
the webview fails to render. The webview HTML head (`src/panel.ts:96`) also has **no
Content-Security-Policy** meta tag — standard practice for VS Code webviews.

**Fix direction:** escape `<` as `<` in the serialized payload (e.g.
`.replace(/</g,'\\u003c')`) and add a CSP `<meta>`. Identifiers interpolated into
`infoHtml` (`src/panel.ts:1042`) are `\w`-restricted so low-risk, but the JSON
payload is the real exposure.

---

### 4. Malformed input is silently swallowed — no diagnostics, no tests
**Severity: Low–Medium (UX) · Confirmed**

An unterminated `case` (`findMatchingEndCase` returns `-1`) is `continue`d over
(`src/parser.ts:278`) and produces **zero transitions with `errors: []`**. Repro
`process begin case s is when a => s <= b;` yields no FSM and no error. The user sees
"No FSM found" with no hint that the file is truncated/malformed. The `errors[]`
channel exists and is surfaced by `extension.ts`, but the parser never populates it
for structural problems. **No fixture asserts anything about malformed/error input.**

---

## Untested surfaces (no coverage at all)

- **`src/panel.ts` (1214 lines)** and **`src/extension.ts` (121 lines)** have **zero
  automated tests.** All layout math (circular positioning, edge grouping,
  self-loop/condition-pill rendering), the select/glow/dim state machine, zoom/pan,
  theme handling, and the `goToLine` messaging are unverified. Pure helpers that are
  easily unit-testable without a VS Code host: `groupEdges`, `escapeHtml`
  (`src/panel.ts:1213`), and the label line-wrapping logic (`src/panel.ts:817-836`).
- **`extension.ts` gating logic** — `autoRefresh` config, `locked` panel guard,
  `lastDocUri` matching, `isVhdlDocument` detection — is untestable as written
  because it's inlined in closures; none of it is exercised.

## Parser features that *are* supported but thinly tested

- **Multiple `case` blocks / `caseLine` selection:** only `case_line_second_block.vhd`
  and one `EXPECT_CASELINE` assertion. The "prefer the first case that actually
  assigns" heuristic (`src/parser.ts:284`) has one data point.
- **`with … select` (selected assignment):** `selected_assign` + `combo_selected_range`
  cover the happy path, but no fixture combines it with a `when others` that must
  subtract range-covered states, nor a selected-assignment whose selector never
  appears in a `case`.
- **Negation/precedence formatting** (`negate`, `parenthesizeForAnd`,
  `hasTopLevelLowPrecOp`): `or_and_precedence.vhd` covers `or`, but `xor/nand/nor/xnor`
  and nested mixed-precedence chains are unexercised despite dedicated code paths.
- **De-dup and self-loop filtering** (`emit`, `src/parser.ts:755`): `self_loop.vhd`
  covers self-loop drop; duplicate-transition de-dup has no dedicated fixture.

---

## Recommended next steps

1. **Fix + fixture** for block comments (#1) — highest value, silently wrong today.
2. **Fix + fixture** for string-literal stripping (#2).
3. Harden the webview payload and add a CSP (#3).
4. Populate `errors[]` for unterminated `case`/`if` and add a malformed-input fixture (#4).
5. Extract `groupEdges`/`escapeHtml`/label-wrap into a testable module and add unit tests.
6. Add fixtures for `xor/nand`-family precedence and `with select` + `others` interplay.
