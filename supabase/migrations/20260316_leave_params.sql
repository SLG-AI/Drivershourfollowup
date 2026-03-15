-- Monthly leave (congés) parameters per scenario
CREATE TABLE IF NOT EXISTS wp_scenario_monthly_leave_params (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id UUID NOT NULL REFERENCES wp_scenarios(id) ON DELETE CASCADE,
  mois INT NOT NULL CHECK (mois BETWEEN 1 AND 12),
  projected_leave_rate NUMERIC NOT NULL DEFAULT 0,
  centre_cout TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_leave_params_scenario_id ON wp_scenario_monthly_leave_params(scenario_id);

ALTER TABLE wp_scenario_monthly_leave_params ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage leave params"
  ON wp_scenario_monthly_leave_params FOR ALL TO authenticated USING (true) WITH CHECK (true);
