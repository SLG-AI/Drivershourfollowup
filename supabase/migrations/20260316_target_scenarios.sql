-- Target scenarios (besoins cibles)
CREATE TABLE IF NOT EXISTS wp_target_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE wp_target_scenarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage target scenarios" ON wp_target_scenarios FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Target values: one row per month × depot
CREATE TABLE IF NOT EXISTS wp_target_scenario_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id UUID NOT NULL REFERENCES wp_target_scenarios(id) ON DELETE CASCADE,
  mois INT NOT NULL CHECK (mois BETWEEN 1 AND 12),
  depot TEXT NOT NULL,
  target_etp NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_target_values_scenario_id ON wp_target_scenario_values(scenario_id);

ALTER TABLE wp_target_scenario_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage target values" ON wp_target_scenario_values FOR ALL TO authenticated USING (true) WITH CHECK (true);
