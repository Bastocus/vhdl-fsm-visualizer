-- Issue #6: caseLine should point to the case block that actually transitions
-- the FSM signal, not an earlier case on the same selector that only reads it
-- to drive other outputs.
--
-- EXPECT idle -> running | start = '1'
-- EXPECT running -> idle | (always)
-- EXPECT_CASELINE 30

library IEEE;
use IEEE.STD_LOGIC_1164.all;

entity fsm_test is
end fsm_test;

architecture rtl of fsm_test is
  type state_t is (idle, running);
  signal state : state_t;
  signal start : std_logic;
  signal a, b : std_logic;
begin
  process
  begin
    case state is
      when idle =>
        a <= '1';
      when running =>
        b <= '1';
    end case;

    case state is
      when idle =>
        if start = '1' then
          state <= running;
        end if;
      when running =>
        state <= idle;
    end case;
    wait;
  end process;
end rtl;
