-- Phase 4: `with … select` combined with a `to` range choice and a `when others`
-- clause. The range s0 to s2 covers three states; `when others` must expand to
-- exactly the remaining states (s3, s4) without re-including range-covered ones.
--
-- EXPECT s0 -> s4 | (always)
-- EXPECT s1 -> s4 | (always)
-- EXPECT s2 -> s4 | (always)
-- EXPECT s3 -> s0 | (always)
-- EXPECT s4 -> s0 | (always)

library IEEE;
use IEEE.STD_LOGIC_1164.all;

entity fsm_selected_others_range is
end fsm_selected_others_range;

architecture rtl of fsm_selected_others_range is
  type state_t is (s0, s1, s2, s3, s4);
  signal current_state, next_state : state_t;
begin
  with current_state select next_state <=
    s4 when s0 to s2,   -- range: covers s0, s1, s2
    s0 when others;     -- must expand to s3 and s4 only
end rtl;
