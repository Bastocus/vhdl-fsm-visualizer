# Roadmap: Fix undetected VHDL state transitions

## Context

`VhdlFsmParser` (`src/parser.ts`) misses or mis-parses several **legal VHDL**
constructs, causing state transitions to silently disappear from the diagram. The
gaps were found by probing the parser directly and were each validated against the
IEEE 1076-2019 grammar productions (confirmed via an equivalent ANTLR VHDL grammar,
since the official 1076-2019 PDF host is blocked by this environment's network policy;
the productions — `conditional_signal_assignment`, `selected_signal_assignment`,
`choice : … | discrete_range | simple_expression | OTHERS`, `exit_statement`/
`next_statement` with `WHEN condition`, and `qualified_expression` — are unchanged from
2008 for these constructs).

Confirmed defects (all reproduced against the live parser):

| # | Construct | Symptom | Severity |
|---|-----------|---------|----------|
| 1 | `when` keyword overloaded | `splitCaseArms` treats *every* `when` as an arm delimiter, so a conditional assignment / `exit when` / `next when` inside one arm swallows the following arm(s) → transitions silently dropped | **HIGH** |
| 2 | Conditional signal assignment `x <= a when c else b;` | RHS isn't `bare_word ;` → no transition emitted | **HIGH** |
| 3 | Qualified/parenthesized RHS `next <= t'(s);`, `next <= (s);` | RHS isn't a bare word → missed | MEDIUM |
| 4 | Case choice range `when s1 to s2 =>` | range label not in `knownStates` → arm skipped, and a sibling `when others` over-expands | MEDIUM |
| 5 | Selected assignment `with sel select x <= …;` | not recognised → 0 FSMs | MEDIUM |
| 6 | `case? … end case?;` (matching case) | header regex `\bcase\s+…\s+is` won't match `case?` | LOW |

**Root cause of #1** (the highest-value fix): `splitCaseArms` (`src/parser.ts:461`)
matches `\bwhen\b … =>` non-greedily. A stray `when` with no `=>` of its own eats
forward to the next real arm's `=>`, merging two arms into one garbage label. The LRM
`choice` rule guarantees an arm-`when`'s label is a choice list only — never an
expression containing `else`/`=`/`;` — and an arm-`when` always begins a statement.

**Guiding invariants (from `CLAUDE.md`, must hold every phase):**
- Normalisation pads comments with spaces so `normalised[i]` aligns with
  `originalSource[i]`; always slice display text from `originalSource`.
- FSMs keyed by enum **type**, not signal.
- `when others` / `when s1 | s2` expand to one transition per concrete state (no
  pseudo-nodes) — extend the same rule to ranges (Phase 4).
- **Do not restyle** the diagram; all UI is additive. These phases are parser-only.
- Self-loops (`from === to`) are intentionally filtered in `emit` (`src/parser.ts:448`).

**Per-phase commit workflow (`CLAUDE.md`):** add fixture(s) → implement → bump
`package.json` version (each phase = **minor**, continuing from the current 0.5:
Phase 1 → 0.6.0, Phase 2 → 0.7.0, …) →
`npm install` → `npm run compile` → `npm test` (all prior fixtures stay green, new one
turns green) → commit. Fixtures are self-checking via `-- EXPECT from -> to | cond`
headers (`test/run.ts`); `KNOWN_FAILS` in `test/run.ts:29` is currently empty — a phase
is done only when its new fixture passes with `KNOWN_FAILS` still empty.

---

## Phase 1: Disambiguate the `when` keyword in case-arm splitting

**Goal:** Stop conditional assignments, `exit when`, and `next when` from silently
swallowing adjacent case arms — the single highest-value fix, and a prerequisite for
Phase 2. This alone stops transitions from vanishing in real FSMs.

**Context for this session:**
- Parser is `src/parser.ts` (single class `VhdlFsmParser`); no build step needed to
  read. Phases 1–3 landed: recursive if/elsif/else + nested case, two-process FSMs
  grouped by enum type, `when others`, `when s1 | s2`, `:=`/variable assignment.
- `splitCaseArms(start, end)` (`src/parser.ts:461`) splits a case body into arms with
  regex `/\bend\s+case\b|\bend\s+if\b|\bcase\b|\bif\b|\bwhen\b\s+([\s\S]*?)\s*=>/g`,
  tracking `depth` for nested `if`/`case`. It is called by both `parseTopCase`
  (`:261`) and `parseCase` (`:409`), so fixing it fixes every case level.
- Reproduction: an arm body containing `next_state <= running when go='1' else idle;`
  or `exit when go='1';` currently drops the *following* arm's transitions.

**Scope — what to implement:**
- In `splitCaseArms`, accept a `when … =>` as an arm boundary **only when the `when`
  begins a statement** — i.e. the nearest preceding significant token (comments are
  already blanked to spaces by normalisation) is `is` or `;`. Reject `when` preceded by
  an operand/identifier (conditional/selected assignment) or by `exit`/`next`.
- Recommended implementation: after the regex matches a `when … =>`, look backward from
  `m.index` over whitespace to the previous non-space char run; keep the arm only if
  that token is `is` or the char is `;`. Loops (`end loop;`) and nested constructs end
  in `;`, so multi-statement arm bodies still split correctly.
- Note: the depth counter still must count `if`/`case`; also make sure `loop`/`end loop`
  do not corrupt depth (they currently aren't counted, which is fine since loops use
  `when` only in `exit/next when`, now excluded by the statement-start test).

**Out of scope:** Emitting transitions for the conditional assignment itself (Phase 2) —
here we only need the *other* arms to survive. Selected assignment (Phase 5).

**Done when:**
- New fixtures `test/fixtures/exit_when.vhd` and
  `test/fixtures/cond_assign_neighbor.vhd` (an arm with a conditional assignment whose
  *neighbouring* arms have plain assignments) both pass — the neighbour arms' transitions
  are emitted.
- All 15 existing fixtures still pass; `npm test` green with `KNOWN_FAILS` empty.

---

## Phase 2: Conditional signal/variable assignment (`when … else`)

**Goal:** Emit transitions for `next_state <= s1 when c1 else s2 when c2 else s3;`, a
very common modern next-state style.

**Context for this session:**
- Depends on Phase 1 (arm splitting must already ignore the `when` inside a conditional
  assignment). Assignments are recognised in `parseStatements` (`src/parser.ts:304`) by
  the third regex alternative `\b(?:${sigAlt})\s*(?:<=|:=)\s*(\w+)\s*;` (`:315`), which
  only matches a bare word RHS terminated by `;`.
- Conditions are built as AND-chains with `negate` (`src/parser.ts:528`) for the
  implicit `else` guard, exactly like `parseIf` (`:355`) does for if/elsif/else. Reuse
  that convention so output matches existing fixtures' style.
- Grammar (LRM): `conditional_waveforms ::= { waveform when condition else } waveform`.

**Scope — what to implement:**
- Add a branch in `parseStatements` (or a helper called from it) that detects
  `<target> <= <expr> when <cond> [else <expr> when <cond>]… [else <expr>] ;` where
  `<target>` is in `ctx.assignSigs`. Parse each `when`-branch and the trailing `else`:
  - branch k: `emit(fromState, stateK, conds + [not(c0)…not(c_{k-1}), c_k])`
  - trailing else: `emit(fromState, stateN, conds + [not(c0)…not(c_last)])`
  - only emit when the branch's target word is in `ctx.knownStates`.
- Also support `:=` (variable) form, mirroring the existing `<=|:=` handling.
- Ensure the regex/scan is bounded to a single statement (up to the terminating `;` at
  paren depth 0) so it doesn't run past the assignment.

**Out of scope:** `with … select` (Phase 5). Qualified RHS inside the waveforms
(Phase 3 generalises RHS extraction; if trivial to reuse here, do so, otherwise leave
qualified RHS in conditional assignments to Phase 3's helper).

**Done when:**
- New fixture `test/fixtures/conditional_assign.vhd` (mix of `when…else…` and a plain
  arm) passes with the AND-chain/negation conditions matching the if/elsif style.
- All prior fixtures green; `npm test` passes, `KNOWN_FAILS` empty.

---

## Phase 3: Robust RHS extraction (qualified & parenthesized)

**Goal:** Detect state assignments whose RHS is `type'(state)` or `(state)`, not just a
bare identifier.

**Context for this session:**
- The assignment RHS is captured by `(\w+)\s*;` in `parseStatements` (`src/parser.ts:315`)
  and checked with `ctx.knownStates.has(targetLower)` (`:341`). `next_state <=
  state_t'(running);` and `next_state <= (done);` currently produce nothing.
- Grammar (LRM): `qualified_expression ::= subtype_indication ' ( expression )`.

**Scope — what to implement:**
- Generalise the RHS matcher so the captured RHS may be optionally wrapped: strip a
  leading `type'` qualifier and/or one or more surrounding parens, then test the inner
  identifier against `ctx.knownStates`. Add a small helper
  `unwrapStateRhs(raw): string | null` and route both the plain-assignment path and
  (if not already done in Phase 2) the conditional-assignment path through it.
- Keep offset/line accuracy: `emit` uses `m.index` for the line — continue passing the
  match start so `offsetToLine` stays correct.

**Out of scope:** Arbitrary RHS expressions that *compute* a state (e.g. function calls)
— only qualified/parenthesized wrapping of a literal state name.

**Done when:**
- New fixture `test/fixtures/qualified_rhs.vhd` (uses `type'(state)` and `(state)`)
  passes. All prior fixtures green; `KNOWN_FAILS` empty.

---

## Phase 4: Case choice ranges (`when s1 to s2` / `s1 downto s2`)

**Goal:** Expand a range choice into every enum state in that range, and keep `when
others` from over-expanding when a range already covers states.

**Context for this session:**
- `parseTopCase` (`src/parser.ts:261`) splits each arm label on `|` and checks each part
  against `ctx.knownStates`; unknown parts (like `idle to running`) are skipped, and the
  `covered` set (`:264`) then misses them, so a sibling `when others` (`:277`) expands
  over states the range actually covered. `parseCase` (`:409`) has the analogous logic
  for nested cases.
- Enum states are stored in declaration order in `sig.states` /
  `ctx.stateOrig`/`ctx.knownStates`; ordinal position = index in the enum declaration.
- Grammar (LRM): `choice : … | discrete_range | …`, `discrete_range` includes
  `simple_expression (to|downto) simple_expression`.

**Scope — what to implement:**
- Add a label-part parser: when a part matches `^(\w+)\s+(to|downto)\s+(\w+)$` and both
  endpoints are known states, expand to the inclusive slice of the enum-order list
  between them (respecting `downto` direction). Feed the resulting states into the same
  per-from-state loop used for `|` parts, and add them to `covered` for the `others`
  expansion.
- Apply symmetrically in `parseTopCase` (from-state expansion) and `parseCase`
  (selector-condition expansion — build `sel = s` disjunction / `others` negation over
  the expanded set).

**Out of scope:** Integer/character subtype ranges — this parser is enum-FSM only, so
only enum-literal endpoints need handling.

**Done when:**
- New fixture `test/fixtures/choice_range.vhd` (`when idle to running =>` plus a `when
  others =>`) passes with one transition set per covered state and no over-expansion.
- All prior fixtures green; `KNOWN_FAILS` empty.

---

## Phase 5: Selected signal assignment (`with … select`)

**Goal:** Detect concurrent/sequential `with <sel> select <target> <= v1 when ch1, … ,
vN when others;` and emit transitions.

**Context for this session:**
- Transition discovery is driven by `extractTransitions` (`src/parser.ts:217`), which
  finds `case <sig> is` headers via `headerRe` (`:227`) and recurses. `with…select` has
  no `case` header, so it's invisible today (probe: 0 FSMs).
- Grammar (LRM): `selected_signal_assignment ::= with expression select target <=
  selected_waveforms ;`, `selected_waveforms ::= { waveform when choices , } waveform
  when choices`. Choices reuse `|`, `others`, and (per Phase 4) ranges.
- Reuse: `ctx` construction and `emit` from `extractTransitions`; `splitCaseArms`-style
  choice handling and the Phase-4 range expander for the `when choices` parts.

**Scope — what to implement:**
- Add a scanner (called from `extractTransitions`, alongside the `case` header loop) for
  `with\s+(<sel>)\s+select\s+(<target>)\s*<=\s*<selected_waveforms>;` where `<sel>` and
  `<target>` are group signals. For each `value when choices` clause, treat `choices` as
  the **from-state(s)** (when `sel` is the state signal) and `value` as the to-state;
  handle `when others` by negation/uncovered expansion as in `parseTopCase`.
- Respect enum grouping: `with` selector and `<=` target may be different signals of the
  same enum type (two-process style).

**Out of scope:** `with … select?` matching selected assignment (rare; fold into Phase 6
if trivial). Non-state selectors.

**Done when:**
- New fixture `test/fixtures/selected_assign.vhd` passes. All prior fixtures green;
  `KNOWN_FAILS` empty.

---

## Phase 6: `case?` matching case statement

**Goal:** Parse VHDL-2008/2019 matching-case (`case? sel is … end case?;`).

**Context for this session:**
- `headerRe` in `extractTransitions` (`src/parser.ts:227`) is
  `\bcase\s+(${sigAlt})\s+is\b`; `findMatchingEndCase` (`:486`) and `tokenEnd` (`:512`)
  match `\bend\s+case\b|\bcase\b`. None accept a trailing `?`.
- Also `parseStatements` (`:312`) and `splitCaseArms` (`:462`) reference `case`/`end
  case` for nested cases.

**Scope — what to implement:**
- Allow an optional `?` after `case` and after `end case` in every relevant regex:
  `headerRe`, `findMatchingEndCase`, the `parseStatements` construct regex, `tokenEnd`
  usages, and `splitCaseArms`. Use `\bcase\??` / `\bend\s+case\??` consistently.
- Verify depth counting still balances (an opening `case?` must be paired with its
  `end case?`).

**Out of scope:** `?=` matching operators / `std_match` semantics in conditions — the
condition text is passed through verbatim, so no change needed there.

**Done when:**
- New fixture `test/fixtures/matching_case.vhd` (`case? … end case?;`) passes. All prior
  fixtures green; `KNOWN_FAILS` empty.

---

## Summary table

| Phase | Title | Model | Effort | Key deliverable |
|-------|-------|-------|--------|-----------------|
| 1 | Disambiguate `when` in arm splitting | Sonnet | medium | `splitCaseArms` only splits on statement-start `when`; `exit_when.vhd`, `cond_assign_neighbor.vhd` |
| 2 | Conditional assignment `when…else` | Sonnet | medium | Emit transitions for `x <= a when c else b`; `conditional_assign.vhd` |
| 3 | Robust RHS (qualified/paren) | Haiku | low | `unwrapStateRhs` helper; `qualified_rhs.vhd` |
| 4 | Case choice ranges `a to b` | Sonnet | medium | Range→enum-slice expansion in `parseTopCase`/`parseCase`; `choice_range.vhd` |
| 5 | Selected assignment `with…select` | Sonnet | medium | New scanner in `extractTransitions`; `selected_assign.vhd` |
| 6 | `case?` matching case | Haiku | low | Optional `?` in case regexes; `matching_case.vhd` |

Recommended order: **1 → 2 → 3 → 4 → 5 → 6** (Phase 1 first — it's a prerequisite and
stops silent data loss). Minimum viable subset for modern-FSM coverage: Phases 1, 2, 3.

## Verification (every phase)

1. `npm install && npm run compile` — TypeScript compiles clean.
2. `npm test` (`tsx test/run.ts`) — the phase's new fixture passes, **all** prior
   fixtures stay green, `KNOWN_FAILS` (`test/run.ts:29`) remains empty, and any
   `EXPECT_CASELINE` assertions hold.
3. Optional ad-hoc probe: instantiate `new VhdlFsmParser().parse(src)` on a scratch
   `.vhd` snippet and print `fsms.flatMap(f => f.transitions)` to eyeball
   `from -> to | condition` before writing the fixture's `-- EXPECT` lines.
4. Bump `package.json` version (minor per phase), then commit per the `CLAUDE.md`
   workflow. Do **not** trigger a release (releases are user-initiated only).
