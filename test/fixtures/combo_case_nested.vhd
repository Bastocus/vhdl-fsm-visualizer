-- combo_case_nested.vhd
-- Integration fixture: combines several phases in ONE nested construct to prove
-- they compose, not just work in isolation.
--   * Phase 6: matching-case `case? … end case?;`
--   * Phase 4: range arm `when idle to running =>` (expands to idle + running)
--   * nested if/else inside that range arm (recursive walker)
--   * Phase 3: qualified RHS `state_t'(paused)` and paren RHS `(done)`
--   * Phase 2: conditional assignment `running when resume='1' else idle`
--   * `when others =>` covers the one remaining state (done)
--
-- EXPECT idle    -> paused  | go = '1'
-- EXPECT idle    -> done    | not (go)
-- EXPECT running -> paused  | go = '1'
-- EXPECT running -> done    | not (go)
-- EXPECT paused  -> running | resume = '1'
-- EXPECT paused  -> idle    | not (resume)
-- EXPECT done    -> idle    | (always)

library ieee;
use ieee.std_logic_1164.all;

entity combo_case_nested is
  port (clk, go, resume : in std_logic);
end entity;

architecture rtl of combo_case_nested is
  type state_t is (idle, running, paused, done);
  signal current_state, next_state : state_t;
begin

  process(clk) is
  begin
    if rising_edge(clk) then
      current_state <= next_state;
    end if;
  end process;

  process(current_state, go, resume) is
  begin
    case? current_state is
      when idle to running =>
        if go = '1' then
          next_state <= state_t'(paused);
        else
          next_state <= (done);
        end if;
      when paused =>
        next_state <= running when resume = '1' else idle;
      when others =>
        next_state <= idle;
    end case?;
  end process;

end architecture;
