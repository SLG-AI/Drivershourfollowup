-- ============================================================
-- Absences MCT (Maladie Court Terme non prise en charge CNS)
-- ============================================================

-- Update wp_imports file_type check to include new type
ALTER TABLE wp_imports DROP CONSTRAINT IF EXISTS wp_imports_file_type_check;
ALTER TABLE wp_imports ADD CONSTRAINT wp_imports_file_type_check
  CHECK (file_type IN ('roster_rh', 'salary_stats', 'absences_cns', 'absences_mct'));

CREATE TABLE IF NOT EXISTS wp_absences_mct (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_salarie TEXT NOT NULL,
  nom_salarie TEXT,
  equipe TEXT,
  prestation TEXT,
  date_absence DATE NOT NULL,
  duree_hrs NUMERIC DEFAULT 0,
  a_charge_cns TEXT,  -- "O" ou "N"
  mois INTEGER NOT NULL CHECK (mois BETWEEN 1 AND 12),
  annee INTEGER NOT NULL,
  import_id UUID REFERENCES wp_imports(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wp_absences_mct_code ON wp_absences_mct(code_salarie);
CREATE INDEX IF NOT EXISTS idx_wp_absences_mct_period ON wp_absences_mct(annee, mois);
CREATE INDEX IF NOT EXISTS idx_wp_absences_mct_import ON wp_absences_mct(import_id);

ALTER TABLE wp_absences_mct ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage wp_absences_mct" ON wp_absences_mct FOR ALL TO authenticated USING (true) WITH CHECK (true);
