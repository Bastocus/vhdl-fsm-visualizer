-- Dense layout: 5 states with multiple transitions to force label clustering
-- EXPECT idle -> s1 | cond_a
-- EXPECT idle -> s2 | not (cond_a) and cond_b
-- EXPECT idle -> s3 | not (cond_a) and not (cond_b) and cond_c
-- EXPECT s1 -> idle | cond_d
-- EXPECT s1 -> s4 | not (cond_d) and cond_e
-- EXPECT s2 -> s3 | cond_a
-- EXPECT s2 -> s1 | not (cond_a) and cond_e
-- EXPECT s2 -> idle | not (cond_a) and not (cond_e)
-- EXPECT s3 -> s4 | cond_c
-- EXPECT s3 -> s1 | not (cond_c) and cond_d
-- EXPECT s3 -> idle | not (cond_c) and not (cond_d)
-- EXPECT s4 -> idle | cond_b
-- EXPECT s4 -> s2 | not (cond_b) and cond_a
architecture rtl of fsm_dense is
  type state_t is (idle, s1, s2, s3, s4);
  signal state, next_state : state_t;
begin
  process(clk)
  begin
    if rising_edge(clk) then
      state <= next_state;
    end if;
  end process;

  process(state, cond_a, cond_b, cond_c, cond_d, cond_e)
  begin
    next_state <= state;
    case state is
      when idle =>
        if cond_a then
          next_state <= s1;
        elsif cond_b then
          next_state <= s2;
        elsif cond_c then
          next_state <= s3;
        end if;
      when s1 =>
        if cond_d then
          next_state <= idle;
        elsif cond_e then
          next_state <= s4;
        end if;
      when s2 =>
        if cond_a then
          next_state <= s3;
        elsif cond_e then
          next_state <= s1;
        else
          next_state <= idle;
        end if;
      when s3 =>
        if cond_c then
          next_state <= s4;
        elsif cond_d then
          next_state <= s1;
        else
          next_state <= idle;
        end if;
      when s4 =>
        if cond_b then
          next_state <= idle;
        elsif cond_a then
          next_state <= s2;
        end if;
    end case;
  end process;
end architecture;
