-- Phase 3: when others with a default transition covering multiple states.
-- "when others" expands to every state not named by another top-level arm —
-- here that's both `done` and `error`, each getting its own arrow to `idle`.
--
-- EXPECT idle -> running | (always)
-- EXPECT running -> done | (always)
-- EXPECT done -> idle | (always)
-- EXPECT error -> idle | (always)

library IEEE;
use IEEE.STD_LOGIC_1164.all;

entity fsm_when_others is
end fsm_when_others;

architecture rtl of fsm_when_others is
  type state_t is (idle, running, done, error);
  signal state : state_t;
begin
  process
  begin
    case state is
      when idle =>
        state <= running;
      when running =>
        state <= done;
      when others =>
        state <= idle;
    end case;
    wait;
  end process;
end rtl;
