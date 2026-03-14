-- Migration: Temporary exit hypotheses for scenarios
-- Allows users to define hypothetical temporary exits (parental leave, maternity, etc.)

CREATE TABLE IF NOT EXISTS wp_scenario_temp_exit_hypotheses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id UUID NOT NULL REFERENCES wp_scenarios(id) ON DELETE CASCADE,
  nb_personnes INT NOT NULL DEFAULT 1,
  taux_occupation NUMERIC NOT NULL DEFAULT 100,
  fonction TEXT,
  centre_cout TEXT,
  depot TEXT,
  vehicle_type TEXT CHECK (vehicle_type IN ('BUS', 'CAM')),
  motif TEXT NOT NULL CHECK (motif IN (
    'Congé parental',
    'Congé maternité',
    'Congé sans solde',
    'Congé d''accompagnement'
  )) DEFAULT 'Congé parental',
  departure_day INT NOT NULL DEFAULT 1 CHECK (departure_day BETWEEN 1 AND 31),
  departure_month INT NOT NULL CHECK (departure_month BETWEEN 1 AND 12),
  departure_year INT NOT NULL,
  return_day INT DEFAULT 1 CHECK (return_day BETWEEN 1 AND 31),
  return_month INT CHECK (return_month BETWEEN 1 AND 12),
  return_year INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_temp_exit_hypotheses_scenario_id ON wp_scenario_temp_exit_hypotheses(scenario_id);

ALTER TABLE wp_scenario_temp_exit_hypotheses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view temp exit hypotheses for their scenarios"
  ON wp_scenario_temp_exit_hypotheses FOR SELECT
  USING (
    scenario_id IN (
      SELECT id FROM wp_scenarios WHERE created_by = auth.uid()
    )
  );

CREATE POLICY "Users can insert temp exit hypotheses for their scenarios"
  ON wp_scenario_temp_exit_hypotheses FOR INSERT
  WITH CHECK (
    scenario_id IN (
      SELECT id FROM wp_scenarios WHERE created_by = auth.uid()
    )
  );

CREATE POLICY "Users can update temp exit hypotheses for their scenarios"
  ON wp_scenario_temp_exit_hypotheses FOR UPDATE
  USING (
    scenario_id IN (
      SELECT id FROM wp_scenarios WHERE created_by = auth.uid()
    )
  );

CREATE POLICY "Users can delete temp exit hypotheses for their scenarios"
  ON wp_scenario_temp_exit_hypotheses FOR DELETE
  USING (
    scenario_id IN (
      SELECT id FROM wp_scenarios WHERE created_by = auth.uid()
    )
  );
