-- Phase 1: `exit when <cond>;` inside a loop must not be mistaken for an arm
-- boundary by splitCaseArms. Before the fix, the non-greedy `when … =>` scan
-- swallowed forward past "exit when go = '1';" all the way to the next real
-- arm's `=>`, dropping the `running` and `done` arms entirely.
--
-- EXPECT idle -> running | (always)
-- EXPECT running -> done | (always)
-- EXPECT done -> idle | (always)

library IEEE;
use IEEE.STD_LOGIC_1164.all;

entity fsm_exit_when is
end fsm_exit_when;

architecture rtl of fsm_exit_when is
  type state_t is (idle, running, done);
  signal state : state_t;
  signal go : std_logic;
begin
  process
  begin
    case state is
      when idle =>
        for i in 0 to 3 loop
          exit when go = '1';
        end loop;
        state <= running;
      when running =>
        state <= done;
      when done =>
        state <= idle;
    end case;
    wait;
  end process;
end rtl;
