-- Phase 2: two-process FSM (case on current_state, assign next_state).
-- The parser groups signals by enum type, so `case current_state is` + the
-- `next_state <= …` assignments merge into one FSM. Conditions follow the Phase-1
-- convention (full AND-chain, explicit negation for elsif/else, every assignment
-- emitted including unconditional and self-loop arms).
--
-- EXPECT idle -> running | go = '1'
-- EXPECT idle -> idle | not (go)
-- EXPECT running -> done | is_done = '1'
-- EXPECT running -> idle | not (is_done) and stop = '1'
-- EXPECT running -> running | not (is_done) and not (stop)
-- EXPECT done -> idle | (always)

library IEEE;
use IEEE.STD_LOGIC_1164.all;

entity fsm_2proc is
end fsm_2proc;

architecture rtl of fsm_2proc is
  type state_t is (idle, running, done);
  signal current_state, next_state : state_t;
  signal go, stop, is_done : std_logic;
begin
  -- Combinatorial process (computes next state)
  process(current_state, go, stop, is_done)
  begin
    case current_state is
      when idle =>
        if go = '1' then
          next_state <= running;
        else
          next_state <= idle;
        end if;
      when running =>
        if is_done = '1' then
          next_state <= done;
        elsif stop = '1' then
          next_state <= idle;
        else
          next_state <= running;
        end if;
      when done =>
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
