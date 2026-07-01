-- Phase 4: two code paths that produce the identical transition (same from, to,
-- and condition) must be de-duplicated — only one edge should appear in output.
--
-- EXPECT idle   -> active | en = '1'
-- EXPECT active -> idle   | (always)

library IEEE;
use IEEE.STD_LOGIC_1164.all;

entity fsm_dedup is
end fsm_dedup;

architecture rtl of fsm_dedup is
  type state_t is (idle, active);
  signal s : state_t;
begin
  process
  begin
    case s is
      when idle =>
        -- same transition reachable from two separate if-blocks; only one edge expected
        if en = '1' then s <= active; end if;
        if en = '1' then s <= active; end if;
      when active =>
        s <= idle;
    end case;
    wait;
  end process;
end rtl;
