-- Phase 1: a string literal containing VHDL-significant chars (`;`, `=>`,
-- `when others`, `end case`, and a `""` escaped quote) must be masked so it
-- never terminates the case or spawns spurious transitions.
--
-- EXPECT idle -> active | (always)
-- EXPECT active -> idle | (always)

library IEEE;
use IEEE.STD_LOGIC_1164.all;
use STD.TEXTIO.all;

entity fsm_string_literal is
end fsm_string_literal;

architecture rtl of fsm_string_literal is
  type state_t is (idle, active);
  signal s : state_t;
begin
  process
    variable l : line;
  begin
    case s is
      when idle =>
        report "when others => end case; a ""quoted"" value";
        s <= active;
      when active =>
        s <= idle;
    end case;
    wait;
  end process;
end rtl;
