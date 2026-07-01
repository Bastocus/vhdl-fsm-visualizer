-- matching_case.vhd
-- Phase 6: VHDL-2008/2019 matching-case statement (`case?`).
-- The `case?` header and `end case?;` use the VHDL matching-case syntax.
-- The parser must treat `case?` identically to `case` for FSM detection.
--
-- EXPECT idle    -> running | (always)
-- EXPECT running -> done    | (always)
-- EXPECT done    -> idle    | (always)

library ieee;
use ieee.std_logic_1164.all;

entity matching_case is
  port (clk : in std_logic);
end entity;

architecture rtl of matching_case is
  type state_t is (idle, running, done);
  signal current_state, next_state : state_t;
begin

  process(clk) is
  begin
    if rising_edge(clk) then
      current_state <= next_state;
    end if;
  end process;

  process(current_state) is
  begin
    case? current_state is
      when idle    => next_state <= running;
      when running => next_state <= done;
      when done    => next_state <= idle;
    end case?;
  end process;

end architecture;
