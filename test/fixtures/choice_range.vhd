-- Fixture: case choice ranges `when s1 to s2` and `when others` correctness
-- Tests Phase 4: range expansion in top-level case arms; `when others` must not
-- over-expand into states already covered by the range.
--
-- Enum order: s0, s1, s2, s3, s4
-- `when s0 to s2 =>` covers s0, s1, s2 → each transitions to s3.
-- `when others =>` covers only s3, s4 → each transitions to s0.
--
-- EXPECT s0 -> s3 | (always)
-- EXPECT s1 -> s3 | (always)
-- EXPECT s2 -> s3 | (always)
-- EXPECT s3 -> s0 | (always)
-- EXPECT s4 -> s0 | (always)

library ieee;
use ieee.std_logic_1164.all;

entity choice_range is
end entity;

architecture rtl of choice_range is
  type state_t is (s0, s1, s2, s3, s4);
  signal state : state_t;
begin
  process(clk)
  begin
    if rising_edge(clk) then
      case state is
        when s0 to s2 =>
          state <= s3;
        when others =>
          state <= s0;
      end case;
    end if;
  end process;
end architecture;
