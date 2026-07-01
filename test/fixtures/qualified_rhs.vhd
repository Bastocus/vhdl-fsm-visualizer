-- Fixture: qualified and parenthesized RHS state assignments
-- Tests Phase 3: unwrapStateRhs strips type'(state) and (state) wrappers.
--
-- EXPECT idle -> running | go = '1'
-- EXPECT running -> done | (always)
-- EXPECT done -> idle | (always)

library ieee;
use ieee.std_logic_1164.all;

entity qualified_rhs is
end entity;

architecture rtl of qualified_rhs is
  type state_t is (idle, running, done);
  signal state : state_t;
begin
  process(clk)
  begin
    if rising_edge(clk) then
      case state is
        when idle =>
          if go = '1' then
            state <= state_t'(running);
          else
            state <= state_t'(idle);
          end if;
        when running =>
          state <= (done);
        when done =>
          state <= (idle);
        when others =>
          null;
      end case;
    end if;
  end process;
end architecture;
