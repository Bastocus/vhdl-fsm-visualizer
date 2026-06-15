# Fix: 3-dot condition labels hidden under state circles

**GitHub Issue:** [#2](https://github.com/Bastocus/vhdl-fsm-diagram/issues/2)

**Status:** Done — Phases A and B implemented; issue closed.

## Problem Statement

When a state machine becomes complex with many transitions, the "..." (3-dot) condition labels that appear on edges become hard to read because they:

1. Get hidden under state circles, making them invisible
2. Scatter around the diagram without a clear visual connection to their edges, causing confusion in dense layouts

Currently, labels are positioned with a fixed perpendicular offset from the edge path, which doesn't account for state circles in the way.

## Root Cause

In `src/panel.ts` (lines ~403-440), the edge rendering:
- Calculates the edge path `{ d, lx, ly }` using `edgePath()` with a curve factor
- Places the "..." label pill at `(lx, ly)` with a fixed offset from the edge midpoint
- Does **not** check if that position falls within any state circle's radius

## Solution

### 1. Position labels on the edge path (Phase A)

**Goal:** Make labels naturally sit "on top of" their edges, not floating nearby.

- Modify the label position calculation to use the edge path's **curve midpoint** directly (or very close to it)
- This naturally associates each "..." with its arrow
- For straight edges, this is the linear midpoint; for curved edges, use the quadratic curve's center

**Implementation:**
- In the edge loop in `render()`, calculate the label position as the midpoint of the `edgePath()` result
- The curve factor logic already exists; reuse it for label positioning

### 2. Collision detection with state circles (Phase B)

**Goal:** If a label would overlap a state circle, shift it perpendicular to the edge to avoid the collision.

**Algorithm:**
```
for each edge:
  labelPos = midpoint of edge path
  for each state:
    distance = |labelPos - statePos|
    if distance < R + LABEL_PADDING:  // collision detected
      // Shift label perpendicular to edge
      perpDir = normal to edge at midpoint
      labelPos += perpDir * offset  // try left offset first
      if still collides:
        labelPos -= perpDir * 2 * offset  // try right offset
        if still collides:
          labelPos -= perpDir * offset / 2  // fall back to smaller offset
      break
```

**Constants to define:**
- `LABEL_PADDING`: margin around state circle (suggest ~10-15 pixels)
- `PERPENDICULAR_OFFSET`: distance to shift label away from edge (suggest ~25-30 pixels)

**Implementation:**
- Add a helper function `isLabelColliding(labelPos, stateCircles, R)` that checks if a point is too close to any state
- In the edge loop, after calculating `labelPos`, call `isLabelColliding()` and adjust if needed
- The perpendicular direction is already available from the curve calculation

### 3. Multi-edge label conflict detection (Phase C, optional enhancement)

**Goal:** If two edges pass near the same point, detect and space their labels apart.

**Approach:**
- After all label positions are calculated, group edges whose labels are close (within `2 * LABEL_PADDING`)
- For grouped edges, nudge their labels in opposite perpendicular directions to create separation

**Trade-off:** This adds visual complexity; may not be necessary if Phase A+B solves the readability problem for most cases.

## Testing Strategy

### New test fixture: `test/fixtures/dense_layout.vhd`

Create a 4-5 state FSM where multiple edges pass through or near the center, forcing the layout algorithm to place several condition labels in a tight region. Example structure:

```vhdl
type state_t is (idle, s1, s2, s3, s4);

case state is
  when idle =>
    if cond_a then next_state <= s1;
    elsif cond_b then next_state <= s2;
    elsif cond_c then next_state <= s3; end if;
  when s1 =>
    if cond_d then next_state <= idle;
    elsif cond_e then next_state <= s4; end if;
  when s2 => ...
  -- More transitions to create visual clutter
```

This fixture won't have automated assertions (labels are visual), but can be manually inspected in the diagram to verify:
- No "..." is hidden under any state circle
- Each "..." is visually associated with its edge
- No two "..." overlap

### Manual verification

1. Build VSIX and open `dense_layout.vhd` in the visualizer
2. Inspect the diagram for:
   - ✓ All "..." visible (none hidden by state circles)
   - ✓ Clear visual path from "..." to its edge
   - ✓ No overlapping labels
3. Compare before/after with a screenshot

### Regression testing

- Run `npm test` to ensure all 10 existing fixtures still pass (parser doesn't change)
- Visually inspect a few previously-complex diagrams (if any exist) to confirm improvement

## Implementation Phases

### Phase A: Label on edge
- Modify label position calculation in `render()`
- Reuse existing edge path midpoint logic
- **No** collision detection yet—just repositioning

### Phase B: Avoid state circles
- Implement `isLabelColliding()` helper
- Add perpendicular offset logic
- Test with `dense_layout.vhd` fixture

### Phase C: Multi-edge spacing (optional)
- Group nearby labels
- Nudge labels in opposite directions
- Risk: may introduce new edge cases; defer unless Phase A+B insufficient

## Files to modify

- `src/panel.ts` — edge label positioning logic (lines ~414-440)
- `test/fixtures/dense_layout.vhd` — new fixture for visual regression testing

## Related code sections

- **Edge path calculation:** `edgePath()` function (~line 277) — computes the quadratic curve and returns midpoint
- **State circle rendering:** `render()` function (~line 468-470) — state position `pos[name]` and radius `R = 48`
- **Current label positioning:** `render()` function (~line 414-418) — calculates `lx, ly` for the "..." pill

## Unknowns / Risks

1. **Perpendicular direction ambiguity**: For a curved edge, which direction is "left" vs "right"? Need to define a consistent convention (e.g., always relative to the edge's tangent at midpoint).
2. **Label size**: Current "..." pill is roughly 34px wide, 17px tall. This needs to be factored into collision detection.
3. **Performance**: Checking every label against every state circle is O(n_edges × n_states). For typical FSMs (10-20 states, 20-40 edges), this is negligible, but worth monitoring.
4. **Bidirectional edges**: When two edges curve opposite ways (due to `hasReverse` logic), their labels might still collide. Phase B should handle this, but needs testing.

## Success criteria

- [x] Issue is understood and documented
- [x] Phase A implemented and tested locally
- [x] Phase B implemented and tested with `dense_layout.vhd`
- [x] No regression in existing fixtures
- [x] VSIX built, version bumped, commit pushed
- [x] GitHub issue closed with explanatory comment

Phase C (multi-edge spacing) was not needed — Phase A+B resolved the readability issue.
