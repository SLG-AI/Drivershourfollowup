-- Fix RLS policies for hypotheses tables: align with wp_scenarios (all authenticated users can manage)

-- arrival hypotheses
DROP POLICY IF EXISTS "Users can view arrival hypotheses for their scenarios" ON wp_scenario_arrival_hypotheses;
DROP POLICY IF EXISTS "Users can insert arrival hypotheses for their scenarios" ON wp_scenario_arrival_hypotheses;
DROP POLICY IF EXISTS "Users can update arrival hypotheses for their scenarios" ON wp_scenario_arrival_hypotheses;
DROP POLICY IF EXISTS "Users can delete arrival hypotheses for their scenarios" ON wp_scenario_arrival_hypotheses;
CREATE POLICY "Authenticated users can manage arrival hypotheses" ON wp_scenario_arrival_hypotheses FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- temp exit hypotheses
DROP POLICY IF EXISTS "Users can view temp exit hypotheses for their scenarios" ON wp_scenario_temp_exit_hypotheses;
DROP POLICY IF EXISTS "Users can insert temp exit hypotheses for their scenarios" ON wp_scenario_temp_exit_hypotheses;
DROP POLICY IF EXISTS "Users can update temp exit hypotheses for their scenarios" ON wp_scenario_temp_exit_hypotheses;
DROP POLICY IF EXISTS "Users can delete temp exit hypotheses for their scenarios" ON wp_scenario_temp_exit_hypotheses;
CREATE POLICY "Authenticated users can manage temp exit hypotheses" ON wp_scenario_temp_exit_hypotheses FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- turnover monthly params
DROP POLICY IF EXISTS "Users can select turnover params" ON wp_scenario_monthly_turnover_params;
DROP POLICY IF EXISTS "Users can insert turnover params" ON wp_scenario_monthly_turnover_params;
DROP POLICY IF EXISTS "Users can update turnover params" ON wp_scenario_monthly_turnover_params;
DROP POLICY IF EXISTS "Users can delete turnover params" ON wp_scenario_monthly_turnover_params;
CREATE POLICY "Authenticated users can manage turnover params" ON wp_scenario_monthly_turnover_params FOR ALL TO authenticated USING (true) WITH CHECK (true);
