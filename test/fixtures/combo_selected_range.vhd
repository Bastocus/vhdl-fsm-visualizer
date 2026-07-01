-- combo_selected_range.vhd
-- Integration fixture: combines several phases in ONE selected assignment.
--   * Phase 5: `with … select` selected signal assignment
--   * Phase 4: range choice `when idle to running`
--   * Phase 3: qualified value `state_t'(done)`
--   * `when others` covers the remaining states (paused, done)
--
-- EXPECT idle    -> done | (always)
-- EXPECT running -> done | (always)
-- EXPECT paused  -> idle | (always)
-- EXPECT done    -> idle | (always)

library ieee;
use ieee.std_logic_1164.all;

entity combo_selected_range is
  port (clk : in std_logic);
end entity;

architecture rtl of combo_selected_range is
  type state_t is (idle, running, paused, done);
  signal current_state, next_state : state_t;
begin

  with current_state select
    next_state <= state_t'(done) when idle to running,
                  idle           when others;

  process(clk) is
  begin
    if rising_edge(clk) then
      current_state <= next_state;
    end if;
  end process;

end architecture;
