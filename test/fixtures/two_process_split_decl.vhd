-- Phase 2 corner case: two-process FSM whose signals are declared on SEPARATE
-- lines (not a comma list). The enum-type grouping must still merge them so the
-- `case current_state is` selector and the `next_state <= …` assignments belong to
-- one FSM. Conditions follow the Phase-1 convention (AND-chain + explicit negation,
-- every assignment emitted including self-loop / unconditional arms).
--
-- EXPECT idle -> active | en = '1'
-- EXPECT idle -> idle | not (en)
-- EXPECT active -> idle | (always)

library IEEE;
use IEEE.STD_LOGIC_1164.all;

entity fsm_2proc_split is
end fsm_2proc_split;

architecture rtl of fsm_2proc_split is
  type state_t is (idle, active);
  signal current_state : state_t;
  signal next_state    : state_t;
  signal en : std_logic;
begin
  -- Combinatorial process (computes next state)
  process(current_state, en)
  begin
    case current_state is
      when idle =>
        if en = '1' then
          next_state <= active;
        else
          next_state <= idle;
        end if;
      when active =>
        next_state <= idle;
    end case;
  end process;

  -- Sequential process
  process
  begin
    wait until rising_edge(clk);
    current_state <= next_state;
  end process;
end rtl;
