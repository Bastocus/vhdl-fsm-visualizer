-- selected_assign.vhd
-- Phase 5: `with … select` concurrent selected signal assignment.
-- Selector is current_state (reads the current state); target is next_state
-- (two-process style, both signals of state_t).  `when others` must expand to
-- the one uncovered state (done → idle).
--
-- EXPECT idle    -> running | (always)
-- EXPECT running -> done    | (always)
-- EXPECT done    -> idle    | (always)

library ieee;
use ieee.std_logic_1164.all;

entity selected_assign is
  port (clk : in std_logic);
end entity;

architecture rtl of selected_assign is
  type state_t is (idle, running, done);
  signal current_state, next_state : state_t;
begin

  -- concurrent selected signal assignment
  with current_state select
    next_state <= running when idle,
                  done    when running,
                  idle    when others;

  process(clk) is
  begin
    if rising_edge(clk) then
      current_state <= next_state;
    end if;
  end process;

end architecture;
