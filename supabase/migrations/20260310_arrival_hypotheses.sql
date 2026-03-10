-- Migration: Arrival hypotheses for scenarios
-- Replaces the simple planned_arrivals columns with a granular hypothesis system

-- 1. Create the arrival hypotheses table
CREATE TABLE IF NOT EXISTS wp_scenario_arrival_hypotheses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id UUID NOT NULL REFERENCES wp_scenarios(id) ON DELETE CASCADE,
  nb_personnes INT NOT NULL DEFAULT 1,
  taux_occupation NUMERIC NOT NULL DEFAULT 100,
  fonction TEXT,
  centre_cout TEXT,
  depot TEXT,
  type_contrat TEXT NOT NULL CHECK (type_contrat IN ('CDI', 'CDD')) DEFAULT 'CDI',
  vehicle_type TEXT CHECK (vehicle_type IN ('BUS', 'CAM')),
  start_day INT NOT NULL DEFAULT 1 CHECK (start_day BETWEEN 1 AND 31),
  start_month INT NOT NULL CHECK (start_month BETWEEN 1 AND 12),
  start_year INT NOT NULL,
  end_day INT DEFAULT 1 CHECK (end_day BETWEEN 1 AND 31),
  end_month INT CHECK (end_month BETWEEN 1 AND 12),
  end_year INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Index on scenario_id for fast lookups
CREATE INDEX idx_arrival_hypotheses_scenario_id ON wp_scenario_arrival_hypotheses(scenario_id);

-- 3. RLS policies
ALTER TABLE wp_scenario_arrival_hypotheses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view arrival hypotheses for their scenarios"
  ON wp_scenario_arrival_hypotheses FOR SELECT
  USING (
    scenario_id IN (
      SELECT id FROM wp_scenarios WHERE created_by = auth.uid()
    )
  );

CREATE POLICY "Users can insert arrival hypotheses for their scenarios"
  ON wp_scenario_arrival_hypotheses FOR INSERT
  WITH CHECK (
    scenario_id IN (
      SELECT id FROM wp_scenarios WHERE created_by = auth.uid()
    )
  );

CREATE POLICY "Users can update arrival hypotheses for their scenarios"
  ON wp_scenario_arrival_hypotheses FOR UPDATE
  USING (
    scenario_id IN (
      SELECT id FROM wp_scenarios WHERE created_by = auth.uid()
    )
  );

CREATE POLICY "Users can delete arrival hypotheses for their scenarios"
  ON wp_scenario_arrival_hypotheses FOR DELETE
  USING (
    scenario_id IN (
      SELECT id FROM wp_scenarios WHERE created_by = auth.uid()
    )
  );

-- 4. Remove old planned_arrivals columns from monthly params
ALTER TABLE wp_scenario_monthly_params
  DROP COLUMN IF EXISTS planned_arrivals,
  DROP COLUMN IF EXISTS planned_arrivals_bus,
  DROP COLUMN IF EXISTS planned_arrivals_cam;
