-- Phase 1: a multi-line `/* … */` block comment spanning several arms must be
-- fully masked (contents ignored) while line numbers stay correct.
--
-- EXPECT idle -> run | (always)
-- EXPECT run -> stop | (always)
-- EXPECT stop -> idle | (always)

library IEEE;
use IEEE.STD_LOGIC_1164.all;

entity fsm_block_comment_multiline is
end fsm_block_comment_multiline;

architecture rtl of fsm_block_comment_multiline is
  type state_t is (idle, run, stop);
  signal s : state_t;
begin
  process
  begin
    case s is
      when idle => s <= run;
      /* this comment spans
         when run => s <= idle;
         end case;
         several lines and arms */
      when run => s <= stop;
      when stop => s <= idle;
    end case;
    wait;
  end process;
end rtl;
