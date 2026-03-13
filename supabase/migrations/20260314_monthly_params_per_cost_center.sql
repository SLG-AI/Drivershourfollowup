-- Add centre_cout column to wp_scenario_monthly_params
-- NULL = global rate (fallback), non-NULL = cost-center-specific rate
ALTER TABLE wp_scenario_monthly_params ADD COLUMN centre_cout TEXT;

-- Drop old unique constraint (scenario_id, mois) and add new one including centre_cout
ALTER TABLE wp_scenario_monthly_params DROP CONSTRAINT IF EXISTS wp_scenario_monthly_params_scenario_id_mois_key;

-- Use a unique index that treats NULL centre_cout as distinct (COALESCE trick)
CREATE UNIQUE INDEX wp_scenario_monthly_params_scenario_mois_cc_uniq
  ON wp_scenario_monthly_params (scenario_id, mois, COALESCE(centre_cout, '__GLOBAL__'));
