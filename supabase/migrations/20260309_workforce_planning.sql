-- ============================================================
-- Workforce Planning module tables
-- ============================================================

-- Import history for WP module
CREATE TABLE IF NOT EXISTS wp_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('roster_rh', 'salary_stats', 'absences_cns')),
  mois INT,
  annee INT,
  imported_by UUID REFERENCES auth.users(id),
  imported_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  error_message TEXT,
  row_count INT DEFAULT 0
);

-- Employee roster from Roster RH import
CREATE TABLE IF NOT EXISTS wp_employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_salarie TEXT NOT NULL,
  code_employeur TEXT,
  date_entree DATE,
  date_sortie DATE,
  type_contrat TEXT,
  taux_occupation NUMERIC DEFAULT 100,
  brut_indice NUMERIC,
  description_fonction TEXT,
  vehicle_type TEXT,
  description_equipe TEXT,
  est_sortie_temporaire BOOLEAN DEFAULT false,
  date_debut_sortie_temporaire DATE,
  date_fin_sortie_temporaire DATE,
  description_motif_sortie TEXT,
  brut_taux_occupation NUMERIC,
  centre_cout TEXT,
  code_equipe TEXT,
  description_service TEXT,
  description_departement TEXT,
  description_direction TEXT,
  import_id UUID REFERENCES wp_imports(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wp_employees_code ON wp_employees(code_salarie);
CREATE INDEX IF NOT EXISTS idx_wp_employees_import ON wp_employees(import_id);
CREATE INDEX IF NOT EXISTS idx_wp_employees_vehicle ON wp_employees(vehicle_type);

-- Monthly salary/hours from StatRapides
CREATE TABLE IF NOT EXISTS wp_salary_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_salarie TEXT NOT NULL,
  nom TEXT,
  prenom TEXT,
  mois INT NOT NULL CHECK (mois BETWEEN 1 AND 12),
  annee INT NOT NULL,
  departement TEXT,
  fonction TEXT,
  date_entree DATE,
  date_sortie DATE,
  tache_pct NUMERIC,
  hrs_base NUMERIC DEFAULT 0,
  hrs_supp NUMERIC DEFAULT 0,
  hrs_chomage NUMERIC DEFAULT 0,
  etp NUMERIC DEFAULT 0,
  supplements NUMERIC DEFAULT 0,
  total_brut NUMERIC DEFAULT 0,
  brut_base NUMERIC DEFAULT 0,
  cout_total_secu NUMERIC DEFAULT 0,
  import_id UUID REFERENCES wp_imports(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wp_salary_code ON wp_salary_stats(code_salarie);
CREATE INDEX IF NOT EXISTS idx_wp_salary_period ON wp_salary_stats(annee, mois);
CREATE INDEX IF NOT EXISTS idx_wp_salary_import ON wp_salary_stats(import_id);

-- CNS absence data
CREATE TABLE IF NOT EXISTS wp_absences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_salarie TEXT NOT NULL,
  equipe TEXT,
  mois INT NOT NULL CHECK (mois BETWEEN 1 AND 12),
  annee INT NOT NULL,
  val_maladie NUMERIC DEFAULT 0,
  hrs_maladie NUMERIC DEFAULT 0,
  jours_maladie NUMERIC DEFAULT 0,
  val_accident NUMERIC DEFAULT 0,
  hrs_accident NUMERIC DEFAULT 0,
  val_raisons_familiales NUMERIC DEFAULT 0,
  hrs_raisons_familiales NUMERIC DEFAULT 0,
  val_conge_accompagnement NUMERIC DEFAULT 0,
  hrs_conge_accompagnement NUMERIC DEFAULT 0,
  val_maternite NUMERIC DEFAULT 0,
  hrs_maternite NUMERIC DEFAULT 0,
  jours_maternite NUMERIC DEFAULT 0,
  val_accueil NUMERIC DEFAULT 0,
  hrs_accueil NUMERIC DEFAULT 0,
  jours_accueil NUMERIC DEFAULT 0,
  pct_absenteisme NUMERIC DEFAULT 0,
  heures_theoriques NUMERIC DEFAULT 0,
  import_id UUID REFERENCES wp_imports(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wp_absences_code ON wp_absences(code_salarie);
CREATE INDEX IF NOT EXISTS idx_wp_absences_period ON wp_absences(annee, mois);
CREATE INDEX IF NOT EXISTS idx_wp_absences_import ON wp_absences(import_id);

-- User-defined headcount targets
CREATE TABLE IF NOT EXISTS wp_target_needs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_type TEXT NOT NULL,
  depot TEXT DEFAULT '',
  work_time TEXT NOT NULL CHECK (work_time IN ('full_time', 'part_time')),
  target_headcount INT NOT NULL,
  target_etp NUMERIC,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(vehicle_type, depot, work_time)
);

-- Named scenario configurations
CREATE TABLE IF NOT EXISTS wp_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN DEFAULT false,
  projected_turnover_rate NUMERIC DEFAULT 5,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Per-month scenario parameters (seasonality support)
CREATE TABLE IF NOT EXISTS wp_scenario_monthly_params (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id UUID NOT NULL REFERENCES wp_scenarios(id) ON DELETE CASCADE,
  mois INT NOT NULL CHECK (mois BETWEEN 1 AND 12),
  projected_absenteeism_rate NUMERIC DEFAULT 5,
  planned_arrivals INT DEFAULT 0,
  planned_arrivals_bus INT DEFAULT 0,
  planned_arrivals_cam INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(scenario_id, mois)
);

-- Known/projected departures per scenario
CREATE TABLE IF NOT EXISTS wp_scenario_departures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id UUID NOT NULL REFERENCES wp_scenarios(id) ON DELETE CASCADE,
  code_salarie TEXT,
  departure_type TEXT NOT NULL CHECK (departure_type IN ('retirement', 'end_contract', 'turnover', 'temp_exit_parental', 'temp_exit_maternity', 'temp_exit_other')),
  departure_month INT NOT NULL CHECK (departure_month BETWEEN 1 AND 12),
  departure_year INT NOT NULL,
  return_month INT CHECK (return_month IS NULL OR return_month BETWEEN 1 AND 12),
  return_year INT,
  vehicle_type TEXT,
  depot TEXT,
  is_from_data BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wp_departures_scenario ON wp_scenario_departures(scenario_id);

-- ============================================================
-- Row Level Security
-- ============================================================

ALTER TABLE wp_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE wp_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE wp_salary_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE wp_absences ENABLE ROW LEVEL SECURITY;
ALTER TABLE wp_target_needs ENABLE ROW LEVEL SECURITY;
ALTER TABLE wp_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE wp_scenario_monthly_params ENABLE ROW LEVEL SECURITY;
ALTER TABLE wp_scenario_departures ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users full access (matching existing pattern)
CREATE POLICY "Authenticated users can manage wp_imports" ON wp_imports FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage wp_employees" ON wp_employees FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage wp_salary_stats" ON wp_salary_stats FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage wp_absences" ON wp_absences FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage wp_target_needs" ON wp_target_needs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage wp_scenarios" ON wp_scenarios FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage wp_scenario_monthly_params" ON wp_scenario_monthly_params FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage wp_scenario_departures" ON wp_scenario_departures FOR ALL TO authenticated USING (true) WITH CHECK (true);
