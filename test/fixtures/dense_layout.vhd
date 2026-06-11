-- Dense layout: 8 states with many cross-connections to force label clustering
-- EXPECT idle -> s1 | cond_a
-- EXPECT idle -> s2 | not (cond_a) and cond_b
-- EXPECT idle -> s3 | not (cond_a) and not (cond_b) and cond_c
-- EXPECT idle -> s4 | not (cond_a) and not (cond_b) and not (cond_c) and cond_d
-- EXPECT s1 -> idle | cond_e
-- EXPECT s1 -> s2 | not (cond_e) and cond_a
-- EXPECT s1 -> s5 | not (cond_e) and not (cond_a) and cond_f
-- EXPECT s1 -> s6 | not (cond_e) and not (cond_a) and not (cond_f)
-- EXPECT s2 -> s3 | cond_b
-- EXPECT s2 -> s4 | not (cond_b) and cond_c
-- EXPECT s2 -> s1 | not (cond_b) and not (cond_c) and cond_d
-- EXPECT s2 -> s7 | not (cond_b) and not (cond_c) and not (cond_d)
-- EXPECT s3 -> s4 | cond_a
-- EXPECT s3 -> s5 | not (cond_a) and cond_e
-- EXPECT s3 -> idle | not (cond_a) and not (cond_e) and cond_b
-- EXPECT s3 -> s8 | not (cond_a) and not (cond_e) and not (cond_b)
-- EXPECT s4 -> s5 | cond_f
-- EXPECT s4 -> s6 | not (cond_f) and cond_c
-- EXPECT s4 -> s2 | not (cond_f) and not (cond_c) and cond_d
-- EXPECT s4 -> idle | not (cond_f) and not (cond_c) and not (cond_d)
-- EXPECT s5 -> s6 | cond_d
-- EXPECT s5 -> s7 | not (cond_d) and cond_a
-- EXPECT s5 -> s8 | not (cond_d) and not (cond_a) and cond_b
-- EXPECT s5 -> idle | not (cond_d) and not (cond_a) and not (cond_b)
-- EXPECT s6 -> s7 | cond_e
-- EXPECT s6 -> s8 | not (cond_e) and cond_c
-- EXPECT s6 -> s1 | not (cond_e) and not (cond_c) and cond_f
-- EXPECT s6 -> s3 | not (cond_e) and not (cond_c) and not (cond_f)
-- EXPECT s7 -> s8 | cond_a
-- EXPECT s7 -> idle | not (cond_a) and cond_b
-- EXPECT s7 -> s2 | not (cond_a) and not (cond_b) and cond_d
-- EXPECT s7 -> s4 | not (cond_a) and not (cond_b) and not (cond_d)
-- EXPECT s8 -> idle | cond_c
-- EXPECT s8 -> s1 | not (cond_c) and cond_e
-- EXPECT s8 -> s3 | not (cond_c) and not (cond_e) and cond_a
-- EXPECT s8 -> s5 | not (cond_c) and not (cond_e) and not (cond_a)
architecture rtl of fsm_dense is
  type state_t is (idle, s1, s2, s3, s4, s5, s6, s7, s8);
  signal state, next_state : state_t;
begin
  process(clk)
  begin
    if rising_edge(clk) then
      state <= next_state;
    end if;
  end process;

  process(state, cond_a, cond_b, cond_c, cond_d, cond_e, cond_f)
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
        elsif cond_d then
          next_state <= s4;
        end if;
      when s1 =>
        if cond_e then
          next_state <= idle;
        elsif cond_a then
          next_state <= s2;
        elsif cond_f then
          next_state <= s5;
        else
          next_state <= s6;
        end if;
      when s2 =>
        if cond_b then
          next_state <= s3;
        elsif cond_c then
          next_state <= s4;
        elsif cond_d then
          next_state <= s1;
        else
          next_state <= s7;
        end if;
      when s3 =>
        if cond_a then
          next_state <= s4;
        elsif cond_e then
          next_state <= s5;
        elsif cond_b then
          next_state <= idle;
        else
          next_state <= s8;
        end if;
      when s4 =>
        if cond_f then
          next_state <= s5;
        elsif cond_c then
          next_state <= s6;
        elsif cond_d then
          next_state <= s2;
        else
          next_state <= idle;
        end if;
      when s5 =>
        if cond_d then
          next_state <= s6;
        elsif cond_a then
          next_state <= s7;
        elsif cond_b then
          next_state <= s8;
        else
          next_state <= idle;
        end if;
      when s6 =>
        if cond_e then
          next_state <= s7;
        elsif cond_c then
          next_state <= s8;
        elsif cond_f then
          next_state <= s1;
        else
          next_state <= s3;
        end if;
      when s7 =>
        if cond_a then
          next_state <= s8;
        elsif cond_b then
          next_state <= idle;
        elsif cond_d then
          next_state <= s2;
        else
          next_state <= s4;
        end if;
      when s8 =>
        if cond_c then
          next_state <= idle;
        elsif cond_e then
          next_state <= s1;
        elsif cond_a then
          next_state <= s3;
        else
          next_state <= s5;
        end if;
    end case;
  end process;
end architecture;
