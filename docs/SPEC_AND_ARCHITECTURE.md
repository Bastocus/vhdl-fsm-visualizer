# VHDL FSM Parser — Robust Nested if/case Handling + Transition Table

## Context

The VHDL FSM Visualizer detects FSMs and renders an interactive diagram. The user reports
that in real-world VHDL, state transitions are **sometimes missed and sometimes mis-conditioned**,
especially with nested `if/elsif/else` combined with nested `case` statements.

Root cause: the parser (`src/parser.ts`) **flattens** each `when` arm into a linear
token stream (`IF/ELSIF/ELSE/END_IF/ASSIGN`) and walks it with a condition stack.
The flattening *deliberately ignores nested `case`/`when`*, so inner case-arm selectors are lost,
and the walker emits only the innermost `if` condition. Several common VHDL idioms are also
unmatched by the regexes.

### Confirmed bug inventory

1. **Nested `case` loses its selector** — assignments inside an inner `when X =>` report the
   wrong/`(always)` condition because inner `when`/`case` are skipped by the tokeniser.
2. **Nested `if` reports innermost only** — `if a then if b then s<=s1` reports just `b`, dropping `a`.
3. **Two-process FSMs find nothing** — `extractTransitions` uses one signal name for both the case
   header and the assignment. `case current_state is ... next_state <= s1;` never matches.
4. **`when others` / `when a | b` / `when a to b` missed** — arm regex matches a single identifier only.
5. **Variable assignment `:=` missed** — only `<=` recognized.

### Decisions (from user)

- **Full recursive parser** (replace flatten-and-walk).
- **Full AND-chain** conditions, **with explicit negation** for `elsif`/`else`
  (`else` after `if a` → `not (a)`; `elsif b` → `not (a) and b`).
- **Support two-process FSMs** (case on `current_state`, assign `next_state`; merge into one FSM).
- **Add a Transitions table** panel (From / To / Condition / Line) with row↔edge highlighting;
  keep the diagram + compact `...` pills.
- **Fixtures + a Node test runner.**

---

## Implementation

### Part A — Recursive block parser (`src/parser.ts`)

Replace `tokeniseBlock` + `walkTokens` (and the flat `Token` machinery) with a small recursive
descent over a single normalised `when`-arm body. Keep the existing, working front-end:
normalisation/comment-padding, enum extraction, signal extraction, helpers, and `findMatchingEndCase`.

**New core: `parseStatements(body, offset, ctx, conds)`** — walks a region scanning for the next
control keyword at the current depth and recursing:

- **`if <c> then` … [`elsif <c> then`] … [`else`] … `end if`**
  - Find the matching `end if` by depth (mirror `findMatchingEndCase`, counting `if`/`end if`).
  - Split the span into branches at depth-0 `elsif`/`else`.
  - For branch *k*, the condition path is `conds + [guard_k]` where:
    - `if` branch: `c0`
    - `elsif ck` branch: `not (c0) and ... and not (c_{k-1}) and ck`
    - `else` branch: `not (c0) and ... and not (c_{last})`
  - Recurse `parseStatements` into each branch body.
- **`case <sel> is` … `when V => ...` … `end case`**
  - Use depth-aware `end case` matching (reuse `findMatchingEndCase`).
  - Split into arms at depth-0 `when`. Parse arm labels supporting `V`, `V1 | V2 | ...`,
    `lo to hi`, and `others`. For each label add selector condition `sel = V` (for `others`,
    use `sel = others` or omit — render as literal `others`). Recurse with
    `conds + [selectorCond]`.
- **assignment `<targetSig> (<=|:=) <state> ;`** — when `targetSig` is one of the FSM's signals
  (see Part B) and `<state>` is a known state, emit a transition with `condition = join(conds)`.
  `join` = `fmtCond(conds.filter(Boolean).join(' and '))`; empty → `(always)`.

Condition text is sliced from `originalSource` at matched offsets to preserve case.
De-dup on `from|to|condition`.

The outer driver (`extractTransitions`) still finds each `case <fsmSelector> is`, finds its body
end, splits top-level `when` arms to establish the **from-state**, then calls `parseStatements`
on each arm body with `conds = []`. `when others =>` at the top level maps to concrete states
handled per Part C.

### Part B — Two-process FSM support (`src/parser.ts`)

- An FSM is keyed by **enum type**, not a single signal. Collect *all* signals of that enum type
  (`current_state`, `next_state`, `state`, …) into one `FsmSignal` group.
- Case header selector and assignment target may be **different** signals of the same type.
  In `parseStatements`, accept an assignment when its target signal is **any** signal in the group.
- Emit **one** `ParsedFsm` per enum type (merge), so two-process designs render as a single FSM
  tab instead of two empty ones. `signalName` becomes the case-selector signal (fallback: first).
- `extractFsmSignals` changes from per-signal to group-by-type; `parse()` iterates groups.

### Part C — `when others` and multi-label arms expand to real states (`src/parser.ts`)

**No pseudo-node** — expand to concrete enum states so real arrows are drawn:

- When parsing a top-level `case <selector> is`, first compute:
  - `coveredStates` = every state named by an explicit top-level `when` arm (each label of a
    `when s1 | s2 =>` arm counts).
  - `othersStates` = all enum states of the FSM − `coveredStates`.
- For a **`when others =>`** arm, every assignment `<= target` it produces is emitted **once per
  state in `othersStates`**: `from = each uncovered state`, `to = target`, same `condition`.
  So `when others => state <= idle;` draws an arrow into `idle` from every state not explicitly
  handled.
- For a **multi-label `when s1 | s2 =>`** arm, expand the same way: one transition per label state
  as the `from`.
- Conditions inside these arms still get the full nested if/case condition chain from Part A.

This keeps every `from`/`to` a real declared state, so the diagram layout and existing visuals
are unaffected.

### Part D — Transitions table panel (`src/panel.ts`) — purely additive

**Do not change any existing diagram visuals**: state circles, arrows, the `...` label pills, and
the click-to-select overlay/glow/dimming all stay exactly as they are. The table is a separate,
additive UI element only.

Additive UI in `_getHtml`. No parser-output shape change.

- Add a collapsible **"Transitions"** panel: a table with columns **From · To · Condition · Line**,
  one row per transition (not grouped), monospaced condition.
- Row hover/click → highlight the matching edge by reusing the **existing** `selected`/grouping
  logic — no new edge/state styling introduced.
- Keep the compact `...` pill + tooltip unchanged.
- Show `line` in the row; clicking can post a message (future: jump to source).

---

## Phased Implementation Roadmap

Work is split so no single phase blows the token budget, and **every phase ends by running the
full test runner as a regression gate** — a phase is only "done" when all previously-green
fixtures stay green plus its own new ones pass.

| Phase | Scope | Deliverables | Regression gate | Recommended model / effort |
|------|-------|--------------|-----------------|----------------------------|
| **0 — Harness & scaffolding** | Test infra + `CLAUDE.md`, no parser logic change | `CLAUDE.md`; `tsconfig.test.json`; `test/run.ts`; all `test/fixtures/*.vhd` with `-- EXPECT` headers; `package.json` `test` script + `tsx` devDep | `npm test` runs; `single_process.vhd` green; corner-case fixtures may be red (expected-fail, documented) | **Sonnet 4.6, low–medium** (mechanical) |
| **1 — Recursive parser core (Part A)** | Replace flatten-and-walk with `parseStatements`; nested `if/elsif/else`, nested `case`, full AND-chain + negation | New parser internals in `src/parser.ts` | `single_process`, `nested_if`, `if_elsif_else`, `nested_case`, `nested_if_in_case` all green | **Opus 4.8, high** (hardest logic) |
| **2 — Two-process FSMs (Part B)** | Group signals by enum type; accept assignments to any same-type signal; one merged `ParsedFsm` | `extractFsmSignals` + `parse()` changes | All Phase-1 fixtures stay green; `two_process` green | **Opus 4.8, medium–high** |
| **3 — `when others` / multi-label / `:=` (Part C)** | Expand `others`→uncovered states, `s1\|s2`→per-label; recognize `:=` | arm-expansion in case handling | All prior fixtures green; `when_others`, `when_multi_label`, `variable_assign` green | **Sonnet 4.6, medium** |
| **4 — Transitions table UI (Part D)** | Additive panel in `src/panel.ts`; no diagram-visual changes | collapsible From/To/Condition/Line table, row↔edge highlight | Parser tests still green (UI doesn't touch parser); manual smoke test | **Sonnet 4.6, medium** |

Rationale: only Phase 1 (and the type-grouping in Phase 2) carries real algorithmic risk →
Opus/high. Phases 0/3/4 are mechanical or additive → Sonnet is sufficient and cheaper. Each phase
is independently committable and leaves the test suite runnable.

---

## Test fixtures + runner

### Fixtures — `test/fixtures/*.vhd`

One file per corner case, each with a comment header stating the expected transitions:

- `single_process.vhd` — baseline `case state is` single-process.
- `two_process.vhd` — `case current_state is … next_state <= …` (Part B).
- `nested_if.vhd` — `if a then if b then …` (full AND-chain).
- `if_elsif_else.vhd` — exercises negation rendering.
- `nested_case.vhd` — outer `case state`, inner `case mode` setting next state (Part A).
- `nested_if_in_case.vhd` — nested if/elsif/else *inside* a nested case arm.
- `when_others.vhd` — `when others => state <= idle;`.
- `when_multi_label.vhd` — `when s1 | s2 =>`.
- `variable_assign.vhd` — `:=` assignment of a variable holding state.

### Runner — `test/run.ts` + npm script

- A standalone Node/TS script importing `VhdlFsmParser` from `../src/parser`, reading each fixture,
  parsing, and comparing the produced transitions against an expected set declared in the fixture
  header as `-- EXPECT <from> -> <to> | <condition>` comment lines (condition optional/`*` to
  ignore). Print a per-fixture pass/fail summary and exit non-zero on any mismatch so it doubles
  as the **regression gate** run at the end of every phase.
- Fixtures carry the *correct* expected transitions from the start; in Phase 0 the not-yet-fixed
  corner cases will fail — marked as expected-fails in the runner output (KNOWN_FAILS list) so
  Phase 0 can still exit green, and removed from the list as each phase lands.

---

## Verification

1. `npm install` (adds `tsx`), then `npm test` → all fixtures pass; the runner prints
   each fixture's actual vs expected transitions.
2. Targeted checks against the bug inventory:
   - `two_process.vhd` yields one FSM with transitions (was zero).
   - `nested_case.vhd` / `nested_if_in_case.vhd` report correct selector + AND-chain conditions.
   - `when_others.vhd` and `when_multi_label.vhd` no longer drop arms.
   - `if_elsif_else.vhd` shows `not (...)` negation on else/elsif rows.
3. Manual extension smoke test: open a fixture `.vhd`, run **VHDL: Show FSM Diagram**, confirm
   the diagram + new Transitions table render and row↔edge highlighting works.
4. Confirm no regression on `single_process.vhd` (matches pre-change output aside from richer
   condition strings).

## Files touched

- `src/parser.ts` — Parts A/B/C (Phases 1–3: core rewrite of arm parsing; group-by-enum-type).
- `src/panel.ts` — Part D (Phase 4: Transitions table, row↔edge highlight).
- `CLAUDE.md` (Phase 0), `test/fixtures/*.vhd`, `test/run.ts`, `tsconfig.test.json`,
  `package.json` — Phase 0.

Each phase is committed separately and leaves `npm test` runnable as the regression gate.

## Out of scope / follow-ups

- Click-to-jump from table row to the VHDL source line (handler stub only for now).
- `for`/`while` loop constructs and `:=` to non-state variables.
