-- Phase 1: a conditional signal assignment (`x <= a when c else b;`) inside one
-- arm must not swallow its neighbouring arms. Before the fix, the `when` in
-- "next_state <= waiting when go = '1' else done;" had no `=>` of its own, so the
-- non-greedy scan matched forward to the `running` arm's own `=>` and merged the
-- two arms, dropping the `waiting` and `done` arms below.
-- Phase 2 now also emits transitions for the conditional assignment itself.
--
-- EXPECT idle -> running | (always)
-- EXPECT running -> waiting | go = '1'
-- EXPECT running -> done | not (go)
-- EXPECT waiting -> done | (always)
-- EXPECT done -> idle | (always)

library IEEE;
use IEEE.STD_LOGIC_1164.all;

entity fsm_cond_assign_neighbor is
end fsm_cond_assign_neighbor;

architecture rtl of fsm_cond_assign_neighbor is
  type state_t is (idle, running, waiting, done);
  signal state, next_state : state_t;
  signal go : std_logic;
begin
  process(state, go)
  begin
    case state is
      when idle =>
        next_state <= running;
      when running =>
        next_state <= waiting when go = '1' else done;
      when waiting =>
        next_state <= done;
      when done =>
        next_state <= idle;
    end case;
  end process;
end rtl;
