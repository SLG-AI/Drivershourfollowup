-- ============================================================
-- Add missing columns to wp_scenario_departures for departure hypotheses
-- ============================================================

ALTER TABLE wp_scenario_departures ADD COLUMN IF NOT EXISTS nb_personnes INT NOT NULL DEFAULT 1;
ALTER TABLE wp_scenario_departures ADD COLUMN IF NOT EXISTS taux_occupation NUMERIC NOT NULL DEFAULT 100;
ALTER TABLE wp_scenario_departures ADD COLUMN IF NOT EXISTS fonction TEXT;
ALTER TABLE wp_scenario_departures ADD COLUMN IF NOT EXISTS centre_cout TEXT;
ALTER TABLE wp_scenario_departures ADD COLUMN IF NOT EXISTS departure_day INT NOT NULL DEFAULT 1;

-- Relax departure_type constraint to allow new types
ALTER TABLE wp_scenario_departures DROP CONSTRAINT IF EXISTS wp_scenario_departures_departure_type_check;
ALTER TABLE wp_scenario_departures ADD CONSTRAINT wp_scenario_departures_departure_type_check
  CHECK (departure_type IN ('retirement', 'end_contract', 'turnover', 'temp_exit_parental', 'temp_exit_maternity', 'temp_exit_other', 'conge_parental', 'maternite', 'autre'));
