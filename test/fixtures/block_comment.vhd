-- Phase 1: a single-line block comment containing `when` / `end case` keywords
-- must NOT terminate the case early. All three transitions must be emitted.
--
-- EXPECT a -> b | (always)
-- EXPECT b -> c | (always)
-- EXPECT c -> a | (always)

library IEEE;
use IEEE.STD_LOGIC_1164.all;

entity fsm_block_comment is
end fsm_block_comment;

architecture rtl of fsm_block_comment is
  type state_t is (a, b, c);
  signal s : state_t;
begin
  process
  begin
    case s is
      when a => s <= b; /* when b => end case */
      when b => s <= c;
      when c => s <= a;
    end case;
    wait;
  end process;
end rtl;
