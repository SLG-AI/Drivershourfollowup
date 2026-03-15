-- Monthly turnover parameters per cost center (same pattern as wp_scenario_monthly_params)
CREATE TABLE wp_scenario_monthly_turnover_params (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  scenario_id UUID NOT NULL REFERENCES wp_scenarios(id) ON DELETE CASCADE,
  mois INT NOT NULL CHECK (mois BETWEEN 1 AND 12),
  projected_turnover_rate NUMERIC NOT NULL DEFAULT 5,
  centre_cout TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Unique constraint: one rate per (scenario, month, cost_center_or_global)
CREATE UNIQUE INDEX wp_scenario_monthly_turnover_params_uniq
  ON wp_scenario_monthly_turnover_params (scenario_id, mois, COALESCE(centre_cout, '__GLOBAL__'));

-- RLS policies (same pattern as wp_scenario_monthly_params)
ALTER TABLE wp_scenario_monthly_turnover_params ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view turnover params of their scenarios"
  ON wp_scenario_monthly_turnover_params FOR SELECT
  USING (scenario_id IN (SELECT id FROM wp_scenarios WHERE created_by = auth.uid()));

CREATE POLICY "Users can insert turnover params for their scenarios"
  ON wp_scenario_monthly_turnover_params FOR INSERT
  WITH CHECK (scenario_id IN (SELECT id FROM wp_scenarios WHERE created_by = auth.uid()));

CREATE POLICY "Users can update turnover params of their scenarios"
  ON wp_scenario_monthly_turnover_params FOR UPDATE
  USING (scenario_id IN (SELECT id FROM wp_scenarios WHERE created_by = auth.uid()));

CREATE POLICY "Users can delete turnover params of their scenarios"
  ON wp_scenario_monthly_turnover_params FOR DELETE
  USING (scenario_id IN (SELECT id FROM wp_scenarios WHERE created_by = auth.uid()));
