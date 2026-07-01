-- Phase 2: conditional signal assignment `x <= a when c else b when c2 else d;`
-- (LRM `conditional_waveforms`). Each branch is guarded by the negation of every
-- earlier branch's condition, exactly like `parseIf`'s elsif/else chain, and the
-- chain's guards AND together with any enclosing `if` condition. A plain arm
-- alongside it (s1/s2/s3/s4) must keep working unaffected.
--
-- EXPECT idle -> s1 | en = '1' and a = '1'
-- EXPECT idle -> s2 | en = '1' and not (a) and b = '1'
-- EXPECT idle -> s3 | en = '1' and not (a) and not (b)
-- EXPECT s1 -> s4 | (always)
-- EXPECT s2 -> idle | (always)
-- EXPECT s3 -> idle | (always)
-- EXPECT s4 -> idle | (always)

library IEEE;
use IEEE.STD_LOGIC_1164.all;

entity fsm_conditional_assign is
end fsm_conditional_assign;

architecture rtl of fsm_conditional_assign is
  type state_t is (idle, s1, s2, s3, s4);
  signal state : state_t;
  signal a, b, en : std_logic;
begin
  process
  begin
    case state is
      when idle =>
        if en = '1' then
          state <= s1 when a = '1' else s2 when b = '1' else s3;
        end if;
      when s1 =>
        state <= s4;
      when s2 =>
        state <= idle;
      when s3 =>
        state <= idle;
      when s4 =>
        state <= idle;
    end case;
    wait;
  end process;
end rtl;
