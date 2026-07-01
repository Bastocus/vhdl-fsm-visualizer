/**
 * VHDL FSM Parser  v1.7  (various-fixes Phase 6 — `case?` matching case statement)
 *
 * Changes vs v0.8:
 *  - New `expandRangePart(part, ctx)` helper: when a `when` arm label part matches
 *    `lo to hi` or `lo downto hi` and both endpoints are known states, expands to the
 *    inclusive enum-order slice. Range parts are fed into the same per-state loops used
 *    for `|` multi-label arms and added to `covered` so a sibling `when others` does
 *    not over-expand.
 *  - Applied symmetrically in `parseTopCase` (from-state expansion) and `parseCase`
 *    (selector-condition expansion).
 *
 * Changes vs v0.8  (various-fixes Phase 3 — robust RHS: qualified/paren)
 *
 * Changes vs v0.7:
 *  - New `unwrapStateRhs(raw)` helper strips `type'(state)` qualified forms and
 *    bare-paren `(state)` wrappers so both `next_state <= state_t'(running);` and
 *    `next_state <= (done);` now emit transitions.
 *  - The assignment regex in `parseStatements` now captures qualified/paren forms in
 *    addition to bare words, and both the plain assignment path and the
 *    `parseConditionalAssign` path route through `unwrapStateRhs`.
 *
 * Changes vs v0.7  (various-fixes Phase 2 — conditional signal assignment)
 *
 * Changes vs v0.6:
 *  - `parseStatements` recognises `x <= a when c else b when c2 else d;` (LRM
 *    `conditional_waveforms`), including the `:=` variable form, via
 *    `parseConditionalAssign`. Each branch emits a transition guarded by the
 *    negation of every earlier branch's condition, mirroring `parseIf`'s
 *    elsif/else negation chain.
 *
 * Changes vs v0.5 (various-fixes Phase 1):
 *  - `splitCaseArms` no longer treats every `\bwhen\b … =>` as an arm boundary. A
 *    `when` only starts a new arm if the nearest preceding significant token is `is`
 *    (a `case … is` header) or `;` (end of the previous statement) — see
 *    `isArmStartWhen`. This stops a conditional/selected assignment (`x <= a when c
 *    else b;`) or a loop's `exit`/`next … when cond;` from being mistaken for an arm
 *    label, which previously let the non-greedy `=>` search swallow forward into the
 *    next real arm and silently drop it.
 *
 * Changes vs v0.4 (Phase 3, Part C):
 *  - Top-level `when others =>` arms expand to one transition set per *uncovered*
 *    state (every enum state not named by another top-level `when` arm) — no
 *    pseudo-node, every from/to stays a real declared state.
 *  - Top-level `when s1 | s2 =>` arms expand to one transition set per labelled
 *    state, each with `from` = that state.
 *  - `extractFsmSignals` also collects `variable` declarations of the FSM's enum
 *    type (e.g. a `next_state` variable), and assignments recognise `:=` as well
 *    as `<=`, so `next_state := running;` is treated like a state assignment.
 *
 * Changes vs v0.3 (Phase 2, Part B):
 *  - FSMs are keyed by enum **type**, not by a single signal. All signals of the
 *    same enum type (e.g. `current_state`, `next_state`) are grouped together, so a
 *    two-process design (`case current_state is … next_state <= …`) renders as ONE
 *    merged FSM instead of two empty ones.
 *  - `extractFsmSignals` now groups by type and handles comma-separated declarations
 *    (`signal current_state, next_state : state_t;`).
 *  - The `case` header may select on any signal of the group; assignments to any
 *    signal of the group count as state transitions. `signalName` is the selector.
 *
 * Earlier changes (v0.3, Phase 1 — recursive block parser):
 *  - The flatten-and-walk machinery (tokeniseBlock / walkTokens / flat Token list)
 *    is replaced by a recursive-descent walker, `parseStatements`, that descends
 *    into nested `if/elsif/else` and nested `case` constructs.
 *  - Conditions are now full AND-chains accumulated down the nesting, with explicit
 *    negation for `elsif`/`else` branches (`if a` → `a`; `elsif b` → `not (a) and b`;
 *    `else` → `not (a) and not (b)`).
 *  - Nested `case <sel> is` contributes selector conditions (`sel = V`); a nested
 *    `when others` contributes the negation chain of the arm's sibling labels.
 *  - Condition / identifier text is always sliced from `originalSource` at the matched
 *    offsets so the original source case is preserved.
 *
 * Unchanged front-end (kept from v0.2): normalisation/comment-padding, enum & signal
 * extraction, entity/architecture names, `findMatchingEndCase`, and the various helpers.
 *
 */

export interface FsmState      { name: string; line: number; }
export interface FsmTransition { from: string; to: string; condition: string; line: number; }

/**
 * A group of signals that share one enum **type** (e.g. `current_state` and
 * `next_state` of `state_t`). Two-process FSMs case-select on one signal and assign
 * another, so the parser treats the whole group as a single state machine.
 */
export interface FsmSignal     { name: string; names: string[]; typeName: string; states: string[]; line: number; linesByName: Map<string, number>; }

export interface ParsedFsm {
  signalName: string;
  caseLine: number;
  typeName: string;
  typeLine: number;
  states: FsmState[];
  transitions: FsmTransition[];
  entityName: string;
  architectureName: string;
}

export interface ParseResult { fsms: ParsedFsm[]; errors: string[]; }

/** Immutable, per-FSM context threaded through the recursive walker. */
interface FsmCtx {
  assignSigs:  Set<string>;          // lowercase signal names that count as a state assignment
  knownStates: Set<string>;          // lowercase enum state names
  stateOrig:   Map<string, string>;  // lowercase → original-case state name
  out:         FsmTransition[];
  stateLines:  Map<string, number>;  // lowercase state name → line of its `when` arm (or `when others`)
}

/** One `when` arm of a case statement, located inside the normalised source. */
interface CaseArm {
  labelStart: number;   // absolute offset of the label text (after "when ")
  labelLen:   number;   // length of the label text (up to, excluding "=>")
  bodyStart:  number;   // absolute offset right after "=>"
  bodyEnd:    number;   // absolute offset of the next arm / end case
}

// ── Parser ───────────────────────────────────────────────────────────────────
export class VhdlFsmParser {
  private normalised     = '';
  private originalSource = '';
  private rawLines:  string[] = [];

  parse(source: string): ParseResult {
    this.originalSource = source;
    this.rawLines       = source.split('\n');
    this.normalised     = this.buildNormalised(source);

    const result: ParseResult = { fsms: [], errors: [] };
    try {
      const entityName       = this.extractEntityName();
      const architectureName = this.extractArchitectureName();
      const enumTypes        = this.extractEnumTypes();
      const fsmSignals       = this.extractFsmSignals(enumTypes);

      for (const sig of fsmSignals) {
        const { transitions, selector, caseLine, stateLines } = this.extractTransitions(sig);
        // An enum type that is never *assigned* a state (only read as a `case`
        // selector, e.g. an enum used purely to pick a branch) yields no transitions
        // and is not a state machine — skip it so it doesn't show as an empty FSM tab.
        if (transitions.length === 0) continue;

        const states: FsmState[] = sig.states.map(s => ({
          name: s,
          line: stateLines.get(s.toLowerCase()) ?? this.findStateLine(s),
        }));
        // The case-selector signal names the FSM; fall back to the first signal of
        // the type when no `case` header matched (should not happen if it emitted).
        const signalName = selector ?? sig.name;
        result.fsms.push({
          signalName,
          caseLine:   caseLine ?? 1,
          typeName:   sig.typeName,
          typeLine:   this.findTypeLine(sig.typeName),
          states,
          transitions,
          entityName,
          architectureName,
        });
      }
    } catch (err) {
      result.errors.push(`Parse error: ${err}`);
    }
    return result;
  }

  // ── Normalisation: lowercase + pad comments with spaces ──────────────────
  // Padding (not stripping) preserves character offsets so that
  // normalised[i] === originalSource[i].toLowerCase() for code chars,
  // making it safe to use match.index to slice from originalSource.
  private buildNormalised(source: string): string {
    return source
      .split('\n')
      .map(line => {
        const ci = line.indexOf('--');
        if (ci >= 0) {
          return line.slice(0, ci).toLowerCase() + ' '.repeat(line.length - ci);
        }
        return line.toLowerCase();
      })
      .join('\n');
  }

  // ── Entity / architecture names ──────────────────────────────────────────
  private extractEntityName(): string {
    const m = this.normalised.match(/\bentity\s+(\w+)\s+is\b/);
    return m ? this.originalAt(m.index! + m[0].indexOf(m[1]), m[1].length) : 'unknown';
  }

  private extractArchitectureName(): string {
    const m = this.normalised.match(/\barchitecture\s+(\w+)\s+of\s+\w+\s+is\b/);
    return m ? this.originalAt(m.index! + m[0].indexOf(m[1]), m[1].length) : 'rtl';
  }

  // ── Enum types ────────────────────────────────────────────────────────────
  // Run the regex on originalSource with 'gi' so captured groups are original-case.
  // Store in map as lowercase-key → original-case-values.
  private extractEnumTypes(): Map<string, string[]> {
    const result = new Map<string, string[]>();
    const re = /\btype\s+(\w+)\s+is\s*\(([^)]+)\)\s*;/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.originalSource)) !== null) {
      const typeName = m[1].trim();
      const states   = m[2].split(',').map(s => s.trim()).filter(Boolean);
      if (states.length >= 2) {
        result.set(typeName.toLowerCase(), states);   // key=lower, value=original
      }
    }
    return result;
  }

  // ── FSM signals (grouped by enum type) ────────────────────────────────────
  // One group per enum type, collecting *all* signals of that type so two-process
  // designs (`current_state` selected, `next_state` assigned) merge into one FSM.
  // Also collects `variable` declarations of the same enum type (Phase 3, Part C),
  // so a `next_state` variable assigned via `:=` is treated as part of the group.
  // The declaration regex captures comma lists (`signal a, b : state_t;`).
  private extractFsmSignals(enumTypes: Map<string, string[]>): FsmSignal[] {
    const groups = new Map<string, FsmSignal>();   // key = type name (lowercase)
    const re = /\b(?:signal|variable)\s+([\w\s,]+?)\s*:\s*(\w+)(?:\s*:=\s*[^;]+?)?\s*;/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.originalSource)) !== null) {
      const typeName = m[2].trim();
      const key      = typeName.toLowerCase();
      if (!enumTypes.has(key)) continue;
      const names = m[1].split(',').map(s => s.trim()).filter(Boolean);
      const declLine = this.offsetToLine(m.index);
      let group = groups.get(key);
      if (!group) {
        group = {
          name:     names[0],
          names:    [],
          typeName,
          states:   enumTypes.get(key)!,
          line:     declLine,
          linesByName: new Map(),
        };
        groups.set(key, group);
      }
      for (const n of names) {
        group.names.push(n);
        group.linesByName.set(n.toLowerCase(), declLine);
      }
    }
    return [...groups.values()];
  }

  // ── Transition extraction (outer driver) ─────────────────────────────────
  // Find every `case <sig> is` whose selector is *any* signal of the enum-type group,
  // split its top-level `when` arms to establish the from-state, then recurse into
  // each arm body with an empty condition stack. Assignments to any group signal
  // count as transitions (so a two-process `next_state <= …` is captured).
  // Returns the original-case selector signal that headed the (first) matched case.
  private extractTransitions(sig: FsmSignal): { transitions: FsmTransition[]; selector?: string; caseLine?: number; stateLines: Map<string, number> } {
    const ctx: FsmCtx = {
      assignSigs:  new Set(sig.names.map(s => s.toLowerCase())),
      knownStates: new Set(sig.states.map(s => s.toLowerCase())),
      stateOrig:   new Map(sig.states.map(s => [s.toLowerCase(), s])),
      out:         [],
      stateLines:  new Map(),
    };

    const sigAlt = sig.names.map(s => escapeRegex(s.toLowerCase())).join('|');
    const headerRe = new RegExp(`\\bcase\\??\\s+(${sigAlt})\\s+is\\b`, 'g');
    let selector: string | undefined;
    let caseLine: number | undefined;
    let fallbackCaseLine: number | undefined;
    let hm: RegExpExecArray | null;
    while ((hm = headerRe.exec(this.normalised)) !== null) {
      const selStart = hm.index + /^case\??\s+/.exec(hm[0])![0].length;
      const thisCaseLine = this.offsetToLine(hm.index);
      if (selector === undefined) {
        selector = this.originalAt(selStart, hm[1].length);
        fallbackCaseLine = thisCaseLine;
      }
      const bodyStart = hm.index + hm[0].length;
      const bodyEnd   = this.findMatchingEndCase(bodyStart);
      if (bodyEnd < 0) continue;
      const before = ctx.out.length;
      this.parseTopCase(bodyStart, bodyEnd, ctx);
      // Prefer the line of the first case block that actually assigns the FSM
      // signal (produces transitions) — a case that only branches on the
      // current state without ever changing it is not "where the FSM is".
      if (caseLine === undefined && ctx.out.length > before) {
        caseLine = thisCaseLine;
      }
    }
    // Phase 5: scan for `with <sel> select <target> <= … ;` anywhere in the source.
    const selInfo = this.parseSelectedAssign(sig, ctx);
    if (selector === undefined && selInfo.selector !== undefined) selector = selInfo.selector;
    if (caseLine === undefined && selInfo.caseLine !== undefined) caseLine = selInfo.caseLine;

    return { transitions: ctx.out, selector, caseLine: caseLine ?? fallbackCaseLine, stateLines: ctx.stateLines };
  }

  /**
   * Scan the whole source for `with <sel> select <target> <= <selected_waveforms> ;`
   * where both `sel` and `target` are signals of the same FSM group.
   * Each `val when choices` clause maps choices (from-states) → val (to-state).
   * `when others` expands to every state not named by a sibling explicit choice.
   * Returns the selector signal name and statement line (for FSM metadata), if found.
   */
  private parseSelectedAssign(
    sig: FsmSignal,
    ctx: FsmCtx,
  ): { selector?: string; caseLine?: number } {
    const sigAlt = sig.names.map(s => escapeRegex(s.toLowerCase())).join('|');
    const re = new RegExp(
      `\\bwith\\s+(${sigAlt})\\s+select\\s+(${sigAlt})\\s*<=`,
      'g',
    );
    let result: { selector?: string; caseLine?: number } = {};
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.normalised)) !== null) {
      const stmtOffset = m.index;
      const selLower   = m[1];
      const afterLe    = m.index + m[0].length;

      // Find the terminating semicolon at paren depth 0.
      let depth = 0;
      let semiPos = -1;
      for (let i = afterLe; i < this.normalised.length; i++) {
        const c = this.normalised[i];
        if (c === '(') depth++;
        else if (c === ')') depth--;
        else if (c === ';' && depth === 0) { semiPos = i; break; }
      }
      if (semiPos < 0) continue;

      // Split the body into comma-separated clauses at paren depth 0.
      const clauseTexts: string[] = [];
      let cur = '';
      let d = 0;
      for (let i = afterLe; i < semiPos; i++) {
        const c = this.normalised[i];
        if (c === '(') { d++; cur += c; }
        else if (c === ')') { d--; cur += c; }
        else if (c === ',' && d === 0) { clauseTexts.push(cur); cur = ''; }
        else cur += c;
      }
      if (cur.trim()) clauseTexts.push(cur);

      // Parse each clause into { val, choices }.
      interface Clause { val: string; choices: string; }
      const clauses: Clause[] = [];
      const covered = new Set<string>();

      for (const text of clauseTexts) {
        const wi = text.search(/\bwhen\b/);
        if (wi < 0) continue;
        const val     = text.slice(0, wi).trim();
        const choices = text.slice(wi + 4).trim();
        clauses.push({ val, choices });
        if (choices !== 'others') {
          for (const part of choices.split('|')) {
            const p = part.trim();
            const range = this.expandRangePart(p, ctx);
            if (range.length > 0) range.forEach(s => covered.add(s));
            else if (ctx.knownStates.has(p)) covered.add(p);
          }
        }
      }

      // Emit transitions.
      for (const { val, choices } of clauses) {
        const toLower = this.unwrapStateRhs(val);
        if (toLower === null || !ctx.knownStates.has(toLower)) continue;
        const toState = ctx.stateOrig.get(toLower)!;

        let fromStates: string[];
        if (choices === 'others') {
          fromStates = [...ctx.knownStates].filter(s => !covered.has(s));
        } else {
          fromStates = [];
          for (const part of choices.split('|')) {
            const p = part.trim();
            const range = this.expandRangePart(p, ctx);
            if (range.length > 0) fromStates.push(...range);
            else if (ctx.knownStates.has(p)) fromStates.push(p);
          }
        }
        for (const fromLower of fromStates) {
          this.emit(ctx.stateOrig.get(fromLower)!, toState, [], stmtOffset, ctx);
        }
      }

      // Record selector/caseLine for the first matched statement.
      if (result.selector === undefined) {
        result = {
          selector: this.originalAt(
            m.index + /^\bwith\s+/.exec(m[0])![0].length,
            selLower.length,
          ),
          caseLine: this.offsetToLine(stmtOffset),
        };
      }
    }
    return result;
  }

  /**
   * Top-level FSM case: each `when` arm's label is the *from-state*. Recurse into
   * the arm body with an empty condition stack, once per from-state:
   *   - `when s1 | s2 =>` recurses once per labelled state (Part C).
   *   - `when others =>` recurses once per state not named by another top-level
   *     arm — no pseudo-node, every from/to stays a real declared state (Part C).
   */
  private parseTopCase(bodyStart: number, bodyEnd: number, ctx: FsmCtx): void {
    const arms = this.splitCaseArms(bodyStart, bodyEnd);

    // States covered by an explicit (non-`others`) label, for the `others` expansion.
    const covered = new Set<string>();
    for (const arm of arms) {
      const labelLower = this.normalised.slice(arm.labelStart, arm.labelStart + arm.labelLen).trim();
      if (labelLower === 'others') continue;
      for (const part of labelLower.split('|')) {
        const p = part.trim();
        const range = this.expandRangePart(p, ctx);
        if (range.length > 0) {
          for (const s of range) covered.add(s);
        } else if (ctx.knownStates.has(p)) {
          covered.add(p);
        }
      }
    }

    for (const arm of arms) {
      const labelLower = this.normalised.slice(arm.labelStart, arm.labelStart + arm.labelLen).trim();
      if (labelLower === 'others') {
        for (const stateLower of ctx.knownStates) {
          if (covered.has(stateLower)) continue;
          if (!ctx.stateLines.has(stateLower)) ctx.stateLines.set(stateLower, this.offsetToLine(arm.labelStart));
          this.parseStatements(arm.bodyStart, arm.bodyEnd, [], ctx.stateOrig.get(stateLower)!, ctx);
        }
        continue;
      }
      for (const part of labelLower.split('|')) {
        const p = part.trim();
        const range = this.expandRangePart(p, ctx);
        const states = range.length > 0 ? range : ctx.knownStates.has(p) ? [p] : [];
        for (const stateLower of states) {
          if (!ctx.stateLines.has(stateLower)) ctx.stateLines.set(stateLower, this.offsetToLine(arm.labelStart));
          this.parseStatements(arm.bodyStart, arm.bodyEnd, [], ctx.stateOrig.get(stateLower)!, ctx);
        }
      }
    }
  }

  // ── Recursive statement walker ────────────────────────────────────────────
  /**
   * Walk the region [start, end) of the normalised source at one nesting level,
   * dispatching on the next control construct found at that level:
   *   - `if … then … [elsif … then …] [else …] end if`
   *   - `case … is … when … => … end case`
   *   - `<sig> <= <state> ;` assignment
   *   - `<sig> <= <state> when <cond> [else <state> when <cond>]… [else <state>] ;`
   *     conditional assignment (`conditional_waveforms`)
   * Each `if`/`case` is consumed whole (up to its matching `end`), so the loop only
   * ever sees constructs at the current depth; nested ones are handled by recursion.
   */
  private parseStatements(
    start:     number,
    end:       number,
    conds:     string[],
    fromState: string,
    ctx:       FsmCtx,
  ): void {
    const sigAlt = [...ctx.assignSigs].map(escapeRegex).join('|');
    const re = new RegExp(
      `\\bif\\b\\s+([\\s\\S]*?)\\s+\\bthen\\b` +
      `|\\bcase\\??\\s+([\\s\\S]*?)\\s+\\bis\\b` +
      `|\\b(?:${sigAlt})\\s*(?:<=|:=)\\s*(\\w+'\\(\\w+\\)|\\(\\w+\\)|\\w+)`,
      'g',
    );
    re.lastIndex = start;

    let m: RegExpExecArray | null;
    while ((m = re.exec(this.normalised)) !== null && m.index < end) {
      if (/^if\b/.test(m[0])) {
        // ── if / elsif / else ──
        const cond = this.fmtCond(this.sliceCond(m, /^if\s+/, m[1].length));
        const thenEnd  = m.index + m[0].length;
        const endIf    = this.findMatchingEndIf(thenEnd);
        const stop     = endIf < 0 ? end : endIf;
        this.parseIf(cond, thenEnd, stop, conds, fromState, ctx);
        re.lastIndex = this.tokenEnd(stop, /\bend\s+if\b/);
      } else if (/^case\??/.test(m[0])) {
        // ── case / case? ──
        const selStart = m.index + /^case\??\s+/.exec(m[0])![0].length;
        const headEnd  = m.index + m[0].length;
        const endCase  = this.findMatchingEndCase(headEnd);
        const stop     = endCase < 0 ? end : endCase;
        this.parseCase(selStart, m[2].length, headEnd, stop, conds, fromState, ctx);
        re.lastIndex = this.tokenEnd(stop, /\bend\s+case\??/);
      } else {
        // ── assignment: bare word, qualified, paren-wrapped, or `when … else` chain ──
        const rhsRaw      = m[3];
        const targetLower = this.unwrapStateRhs(rhsRaw);
        const afterWord   = m.index + m[0].length;
        const next        = this.skipWs(afterWord);
        if (this.matchesAt(/when\b/, next)) {
          re.lastIndex = this.parseConditionalAssign(rhsRaw, fromState, conds, ctx, m.index, next);
        } else if (this.normalised[next] === ';') {
          if (targetLower !== null && ctx.knownStates.has(targetLower)) {
            this.emit(fromState, ctx.stateOrig.get(targetLower)!, conds, m.index, ctx);
          }
          re.lastIndex = next + 1;
        }
      }
    }
  }

  /** Index of the first non-whitespace character at or after `idx`. */
  private skipWs(idx: number): number {
    let i = idx;
    while (i < this.normalised.length && /\s/.test(this.normalised[i])) i++;
    return i;
  }

  /** True if `re` matches `this.normalised` starting exactly at `idx`. */
  private matchesAt(re: RegExp, idx: number): boolean {
    const sticky = new RegExp(re.source, 'y');
    sticky.lastIndex = idx;
    return sticky.test(this.normalised);
  }

  /**
   * Strip a qualified (`type'(state)`) or parenthesized (`(state)`) wrapper from
   * an assignment RHS captured by the regex, and return the lowercased inner
   * identifier. Returns null if the string doesn't match any supported form.
   */
  private unwrapStateRhs(raw: string): string | null {
    const s = raw.trim();
    // type'(state) — qualified expression
    const qual = /^\w+'\((\w+)\)$/.exec(s);
    if (qual) return qual[1].toLowerCase();
    // (state) — parenthesized
    const paren = /^\((\w+)\)$/.exec(s);
    if (paren) return paren[1].toLowerCase();
    // bare identifier
    if (/^\w+$/.test(s)) return s.toLowerCase();
    return null;
  }

  /**
   * Expand a single arm-label part that may be a range (`lo to hi` / `lo downto hi`).
   * Returns the inclusive list of *lowercase* state names in declaration order (or
   * reversed for `downto`). If the part is not a range, or its endpoints are not known
   * states, returns an empty array (caller falls back to exact-match logic).
   */
  private expandRangePart(part: string, ctx: FsmCtx): string[] {
    const m = /^(\w+)\s+(to|downto)\s+(\w+)$/i.exec(part.trim());
    if (!m) return [];
    const lo = m[1].toLowerCase();
    const hi = m[3].toLowerCase();
    const dir = m[2].toLowerCase();
    const ordered = [...ctx.knownStates]; // insertion order = enum declaration order
    const loIdx = ordered.indexOf(lo);
    const hiIdx = ordered.indexOf(hi);
    if (loIdx < 0 || hiIdx < 0) return [];
    const [from, to] = dir === 'downto' ? [hiIdx, loIdx] : [loIdx, hiIdx];
    if (from > to) return [];
    const slice = ordered.slice(from, to + 1);
    return dir === 'downto' ? slice.reverse() : slice;
  }

  /**
   * Parse a conditional signal/variable assignment's waveform chain, starting right
   * after the first (bare-word) value, at the `when` keyword:
   *   `<target> <= val0 when cond0 else val1 when cond1 else … valN ;`
   * Emits one transition per branch, each guarded by the negation of every earlier
   * branch's condition (mirroring `parseIf`'s elsif/else negation chain):
   *   branch k: conds + [not(cond0) … not(cond_{k-1}), condK]
   *   trailing valN (no `when`): conds + [not(cond0) … not(condLast)]
   * Returns the offset just past the terminating `;`, for the caller to resume
   * scanning from.
   */
  private parseConditionalAssign(
    firstVal:    string,
    fromState:   string,
    conds:       string[],
    ctx:         FsmCtx,
    stmtStart:   number,
    whenIdx:     number,
  ): number {
    const tokenRe = /\(|\)|\bwhen\b|\belse\b|;/g;
    let depth = 0;
    const nextTopLevel = (from: number): { token: string; index: number } | null => {
      tokenRe.lastIndex = from;
      let mm: RegExpExecArray | null;
      while ((mm = tokenRe.exec(this.normalised)) !== null) {
        if (mm[0] === '(') { depth++; continue; }
        if (mm[0] === ')') { depth--; continue; }
        if (depth !== 0) continue;
        return { token: mm[0], index: mm.index };
      }
      return null;
    };

    const priorConds: string[] = [];
    let curVal = firstVal;
    let pos = whenIdx + 4; // past "when"

    for (;;) {
      const elseTok = nextTopLevel(pos);
      if (!elseTok || elseTok.token !== 'else') return this.normalised.length; // malformed
      const condText = this.fmtCond(this.originalAt(pos, elseTok.index - pos));
      pos = elseTok.index + 4; // past "else"

      const guard = [...priorConds.map(c => this.negate(c)), condText];
      const valLower = this.unwrapStateRhs(curVal);
      if (valLower !== null && ctx.knownStates.has(valLower)) {
        this.emit(fromState, ctx.stateOrig.get(valLower)!, conds.concat(guard), stmtStart, ctx);
      }
      priorConds.push(condText);

      const nextTok = nextTopLevel(pos);
      if (!nextTok) return this.normalised.length; // malformed
      const valText = this.originalAt(pos, nextTok.index - pos).trim();

      if (nextTok.token === ';') {
        const lastLower = this.unwrapStateRhs(valText);
        if (lastLower !== null && ctx.knownStates.has(lastLower)) {
          const elseGuard = priorConds.map(c => this.negate(c));
          this.emit(fromState, ctx.stateOrig.get(lastLower)!, conds.concat(elseGuard), stmtStart, ctx);
        }
        return nextTok.index + 1; // past ";"
      }
      if (nextTok.token !== 'when') return nextTok.index + nextTok.token.length; // malformed
      curVal = valText;
      pos = nextTok.index + 4; // past "when"
    }
  }

  /**
   * Parse an `if … end if`. The region [thenEnd, endIf) is split at depth-0 `elsif`
   * and `else` into branches; each branch is recursed with the appropriate guard:
   *   if c0        → conds + [c0]
   *   elsif ck     → conds + [not(c0) … not(c_{k-1}), ck]
   *   else         → conds + [not(c0) … not(c_last)]
   */
  private parseIf(
    c0: string,
    thenEnd: number,
    endIf: number,
    conds: string[],
    fromState: string,
    ctx: FsmCtx,
  ): void {
    interface Seg { kind: 'if' | 'elsif' | 'else'; cond?: string; bodyStart: number; bodyEnd: number; }
    const segs: Seg[] = [{ kind: 'if', cond: c0, bodyStart: thenEnd, bodyEnd: endIf }];

    const re = /\bend\s+if\b|\bend\s+case\??|\belsif\b\s+([\s\S]*?)\s+\bthen\b|\belse\b|\bif\b|\bcase\??/g;
    re.lastIndex = thenEnd;
    let depth = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.normalised)) !== null && m.index < endIf) {
      const t = m[0];
      if (/^end/.test(t))                       { depth--; continue; }
      if (/^if\b/.test(t) || /^case\??/.test(t)) { depth++; continue; }
      if (depth !== 0) continue;                // elsif/else belonging to a nested if

      segs[segs.length - 1].bodyEnd = m.index;  // close the previous branch
      if (/^elsif/.test(t)) {
        const cond = this.fmtCond(this.sliceCond(m, /^elsif\s+/, m[1].length));
        segs.push({ kind: 'elsif', cond, bodyStart: m.index + t.length, bodyEnd: endIf });
      } else {
        segs.push({ kind: 'else', bodyStart: m.index + t.length, bodyEnd: endIf });
      }
    }

    const prior: string[] = [];   // conditions of preceding branches, for negation
    for (const seg of segs) {
      let guard: string[];
      if (seg.kind === 'if') {
        guard = [seg.cond!];
        prior.push(seg.cond!);
      } else if (seg.kind === 'elsif') {
        guard = [...prior.map(c => this.negate(c)), seg.cond!];
        prior.push(seg.cond!);
      } else {
        guard = prior.map(c => this.negate(c));
      }
      this.parseStatements(seg.bodyStart, seg.bodyEnd, conds.concat(guard), fromState, ctx);
    }
  }

  /**
   * Parse a `case … end case`. Each arm contributes a selector condition:
   *   `when V`        → `sel = V`
   *   `when V1 | V2`  → `(sel = V1 or sel = V2)`
   *   `when others`   → `not (sel = A) and not (sel = B) …` over sibling labels
   * The from-state is inherited from the enclosing FSM arm (a nested case never
   * changes the from-state).
   */
  private parseCase(
    selStart: number,
    selLen: number,
    bodyStart: number,
    bodyEnd: number,
    conds: string[],
    fromState: string,
    ctx: FsmCtx,
  ): void {
    const sel  = this.fmtCond(this.originalAt(selStart, selLen));
    const arms = this.splitCaseArms(bodyStart, bodyEnd);

    // Sibling concrete labels (original-case), used to build the `others` negation chain.
    // Range parts are expanded to individual original-case state names.
    const covered: string[] = [];
    for (const a of arms) {
      const lower = this.normalised.slice(a.labelStart, a.labelStart + a.labelLen).trim();
      if (lower === 'others') continue;
      const orig = this.originalAt(a.labelStart, a.labelLen).trim();
      for (const part of orig.split('|')) {
        const partLower = part.trim().toLowerCase();
        const range = this.expandRangePart(partLower, ctx);
        if (range.length > 0) {
          for (const s of range) covered.push(ctx.stateOrig.get(s)!);
        } else {
          covered.push(part.trim());
        }
      }
    }

    for (const a of arms) {
      const lower = this.normalised.slice(a.labelStart, a.labelStart + a.labelLen).trim();
      let selConds: string[];
      if (lower === 'others') {
        selConds = covered.map(v => this.negate(`${sel} = ${v}`));
      } else {
        // Expand each part (may be a range), collect original-case state names.
        const orig = this.originalAt(a.labelStart, a.labelLen).trim();
        const expanded: string[] = [];
        for (const part of orig.split('|')) {
          const partLower = part.trim().toLowerCase();
          const range = this.expandRangePart(partLower, ctx);
          if (range.length > 0) {
            for (const s of range) expanded.push(ctx.stateOrig.get(s)!);
          } else {
            expanded.push(part.trim());
          }
        }
        const filtered = expanded.filter(Boolean);
        selConds = filtered.length === 1
          ? [`${sel} = ${filtered[0]}`]
          : ['(' + filtered.map(v => `${sel} = ${v}`).join(' or ') + ')'];
      }
      this.parseStatements(a.bodyStart, a.bodyEnd, conds.concat(selConds), fromState, ctx);
    }
  }

  // ── Emit a transition (with de-dup on from|to|condition) ──────────────────
  // Self-loops (from === to) are filtered out (issue #3) as they clutter the diagram.
  private emit(from: string, to: string, conds: string[], offset: number, ctx: FsmCtx): void {
    if (from === to) return;  // ignore self-loops
    const condition = this.joinConds(conds);
    const line      = this.offsetToLine(offset);
    const dup = ctx.out.some(t => t.from === from && t.to === to && t.condition === condition);
    if (!dup) ctx.out.push({ from, to, condition, line });
  }

  // ── Case-arm splitter (depth-aware) ───────────────────────────────────────
  /**
   * Split the case body [start, end) into its top-level `when` arms. Nested
   * `if`/`case` increment a depth counter so their inner `when`s are skipped.
   */
  private splitCaseArms(start: number, end: number): CaseArm[] {
    const re = /\bend\s+case\??|\bend\s+if\b|\bcase\??|\bif\b|\bwhen\b\s+([\s\S]*?)\s*=>/g;
    re.lastIndex = start;
    let depth = 0;
    const arms: CaseArm[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.normalised)) !== null && m.index < end) {
      const t = m[0];
      if (/^end/.test(t))                       { depth--; continue; }
      if (/^case\??/.test(t) || /^if\b/.test(t)) { depth++; continue; }
      if (!this.isArmStartWhen(m.index)) {
        // Not a real arm-opening `when` — a conditional/selected assignment or an
        // `exit`/`next … when` guard. The non-greedy `=>` search may have swallowed
        // past a real arm's `when … =>`, so resume right after this `when` instead
        // of after the whole (bogus) match.
        re.lastIndex = m.index + 4; // "when".length
        continue;
      }
      if (depth !== 0) continue;                // `when` of a nested case

      const labelStart = m.index + /^when\s+/.exec(t)![0].length;
      if (arms.length) arms[arms.length - 1].bodyEnd = m.index;
      arms.push({ labelStart, labelLen: m[1].length, bodyStart: m.index + t.length, bodyEnd: end });
    }
    if (arms.length) arms[arms.length - 1].bodyEnd = end;
    return arms;
  }

  /**
   * True when the `when` at `idx` begins a statement — i.e. the nearest preceding
   * significant token is `is` (a `case … is` header) or `;` (end of the previous
   * statement). A `when` preceded by an operand/identifier (conditional/selected
   * assignment) or by `exit`/`next` fails this test and is not an arm boundary.
   */
  private isArmStartWhen(idx: number): boolean {
    let i = idx;
    while (i > 0 && /\s/.test(this.normalised[i - 1])) i--;
    if (i === 0) return true;
    if (this.normalised[i - 1] === ';') return true;
    return /\bis$/.test(this.normalised.slice(Math.max(0, i - 6), i));
  }

  // ── Block-matching helpers ────────────────────────────────────────────────
  /**
   * Walk forward from `from` in normalised, tracking `case` depth, and
   * return the index of the `end case` that closes depth 1.
   */
  private findMatchingEndCase(from: number): number {
    const re = /\bend\s+case\??|\bcase\??/g;
    re.lastIndex = from;
    let depth = 1;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.normalised)) !== null) {
      if (/^end\s+case/.test(m[0])) { if (--depth === 0) return m.index; }
      else                          { depth++; }
    }
    return -1;
  }

  /** Mirror of findMatchingEndCase for `if` / `end if` (elsif does not nest). */
  private findMatchingEndIf(from: number): number {
    const re = /\bend\s+if\b|\bif\b/g;
    re.lastIndex = from;
    let depth = 1;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.normalised)) !== null) {
      if (/^end\s+if/.test(m[0])) { if (--depth === 0) return m.index; }
      else                        { depth++; }
    }
    return -1;
  }

  /** Length-aware end of a closing token (`end if` / `end case`) starting at `idx`. */
  private tokenEnd(idx: number, token: RegExp): number {
    const re = new RegExp(token.source, 'y');
    re.lastIndex = idx;
    const m = re.exec(this.normalised);
    return m ? idx + m[0].length : idx;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Slice the captured group of `m` from originalSource, given the match's prefix. */
  private sliceCond(m: RegExpExecArray, prefix: RegExp, len: number): string {
    const start = m.index + prefix.exec(m[0])![0].length;
    return this.originalAt(start, len);
  }

  /** Negate a single condition. `x = '1'` → `not (x)`; anything else → `not (cond)`. */
  private negate(cond: string): string {
    const m = /^(.+?)\s*=\s*'1'$/.exec(cond);
    return m ? `not (${m[1].trim()})` : `not (${cond})`;
  }

  /**
   * Join an AND-chain of conditions; empty chain → "(always)".
   * When ANDing 2+ conditions, a part containing a top-level `or`/`xor`/`nor`/
   * `xnor`/`nand` (lower precedence than `and`) is wrapped in parentheses —
   * unless already fully parenthesized — so `if a or b` nested inside `if c`
   * yields `(a or b) and c`, not the ambiguous `a or b and c` (issue #1).
   */
  private joinConds(conds: string[]): string {
    const parts = conds.filter(Boolean);
    if (parts.length === 0) return '(always)';
    if (parts.length === 1) return parts[0];
    return parts.map(c => this.parenthesizeForAnd(c)).join(' and ');
  }

  /** Wrap `cond` in parens if it has a top-level low-precedence operator and
   *  isn't already fully parenthesized. */
  private parenthesizeForAnd(cond: string): string {
    if (this.isFullyParenthesized(cond)) return cond;
    return this.hasTopLevelLowPrecOp(cond) ? `(${cond})` : cond;
  }

  /** True if `s` is wrapped in one matching pair of parens spanning the whole
   *  string, e.g. `(a or b)` but not `(a) or (b)`. */
  private isFullyParenthesized(s: string): boolean {
    if (!s.startsWith('(') || !s.endsWith(')')) return false;
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') {
        depth--;
        if (depth === 0) return i === s.length - 1;
      }
    }
    return false;
  }

  /** True if `s` contains `or`/`xor`/`nor`/`xnor`/`nand` at paren depth 0 —
   *  operators whose precedence relative to `and` makes ANDing `s` as-is
   *  ambiguous. */
  private hasTopLevelLowPrecOp(s: string): boolean {
    let depth = 0;
    const re = /\(|\)|\b(?:or|nor|xor|xnor|nand)\b/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
      if (m[0] === '(') depth++;
      else if (m[0] === ')') depth--;
      else if (depth === 0) return true;
    }
    return false;
  }

  /** Normalise whitespace in a condition string; preserve original case. */
  private fmtCond(raw: string): string {
    return raw.replace(/\s+/g, ' ').trim();
  }

  /** Extract text from originalSource at [offset, offset+length). */
  private originalAt(offset: number, length: number): string {
    return this.originalSource.slice(offset, offset + length);
  }

  /** Convert a byte offset in normalised/originalSource to a 1-based line number. */
  private offsetToLine(offset: number): number {
    return this.normalised.slice(0, offset).split('\n').length;
  }

  /** Find the first line containing stateName (original case, case-insensitive). */
  private findStateLine(name: string): number {
    const lo = name.toLowerCase();
    for (let i = 0; i < this.rawLines.length; i++) {
      const ci = this.rawLines[i].indexOf('--');
      const line = ci >= 0 ? this.rawLines[i].slice(0, ci) : this.rawLines[i];
      if (line.toLowerCase().includes(lo)) return i + 1;
    }
    return 1;
  }

  /** Find the line of `type <typeName> is (...)`. */
  private findTypeLine(typeName: string): number {
    const re = new RegExp(`\\btype\\s+${escapeRegex(typeName)}\\s+is\\s*\\(`, 'i');
    const m = re.exec(this.originalSource);
    return m ? this.offsetToLine(m.index) : 1;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
