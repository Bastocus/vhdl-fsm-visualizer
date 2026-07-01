-- Phase 4: `xor` and `nor` operators at the top level of a condition must be
-- wrapped in parentheses when joined with `and` via a nested `if`, so the
-- generated condition string is unambiguous.
--
-- EXPECT idle   -> active | (a xor b) and c
-- EXPECT active -> idle   | (a nor b) and d = '1'

library IEEE;
use IEEE.STD_LOGIC_1164.all;

entity fsm_xor_precedence is
end fsm_xor_precedence;

architecture rtl of fsm_xor_precedence is
  type state_t is (idle, active);
  signal s : state_t;
begin
  process
  begin
    case s is
      when idle =>
        -- xor has lower precedence than and; must be parenthesized in the output
        if a xor b then
          if c then
            s <= active;
          end if;
        end if;
      when active =>
        -- nor likewise
        if a nor b then
          if d = '1' then
            s <= idle;
          end if;
        end if;
    end case;
    wait;
  end process;
end rtl;
