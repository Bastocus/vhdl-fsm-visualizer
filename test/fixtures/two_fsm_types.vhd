-- Phase 2 corner case: TWO independent FSMs (two distinct enum types) in one file,
-- each two-process. Grouping keys by enum type, so the two must NOT merge and an
-- assignment to one type's signal must never leak into the other FSM. The runner
-- flattens transitions across all FSMs, so all four are expected.
--
-- EXPECT a_idle -> a_run | ga = '1'
-- EXPECT a_run -> a_idle | (always)
-- EXPECT b_idle -> b_run | gb = '1'
-- EXPECT b_run -> b_idle | (always)

library IEEE;
use IEEE.STD_LOGIC_1164.all;

entity fsm_two_types is
end fsm_two_types;

architecture rtl of fsm_two_types is
  type sa_t is (a_idle, a_run);
  type sb_t is (b_idle, b_run);
  signal a_cur, a_nxt : sa_t;
  signal b_cur, b_nxt : sb_t;
  signal ga, gb : std_logic;
begin
  -- FSM A (combinatorial)
  process(a_cur, ga)
  begin
    case a_cur is
      when a_idle =>
        if ga = '1' then
          a_nxt <= a_run;
        end if;
      when a_run =>
        a_nxt <= a_idle;
    end case;
  end process;

  -- FSM B (combinatorial)
  process(b_cur, gb)
  begin
    case b_cur is
      when b_idle =>
        if gb = '1' then
          b_nxt <= b_run;
        end if;
      when b_run =>
        b_nxt <= b_idle;
    end case;
  end process;
end rtl;
