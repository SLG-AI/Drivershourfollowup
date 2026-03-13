-- ============================================================
-- Absences Injustifiées
-- ============================================================

-- Update wp_imports file_type check to include new type
ALTER TABLE wp_imports DROP CONSTRAINT IF EXISTS wp_imports_file_type_check;
ALTER TABLE wp_imports ADD CONSTRAINT wp_imports_file_type_check
  CHECK (file_type IN ('roster_rh', 'salary_stats', 'absences_cns', 'absences_mct', 'absences_injustifiees'));

CREATE TABLE IF NOT EXISTS wp_absences_injustifiees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_salarie TEXT NOT NULL,
  nom_salarie TEXT,
  mois INTEGER NOT NULL CHECK (mois BETWEEN 1 AND 12),
  annee INTEGER NOT NULL,
  date_debut DATE NOT NULL,
  date_fin DATE NOT NULL,
  duree_hrs NUMERIC DEFAULT 0,
  complete BOOLEAN DEFAULT true,
  import_id UUID REFERENCES wp_imports(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wp_absences_injustifiees_code ON wp_absences_injustifiees(code_salarie);
CREATE INDEX IF NOT EXISTS idx_wp_absences_injustifiees_period ON wp_absences_injustifiees(annee, mois);
CREATE INDEX IF NOT EXISTS idx_wp_absences_injustifiees_import ON wp_absences_injustifiees(import_id);

ALTER TABLE wp_absences_injustifiees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage wp_absences_injustifiees" ON wp_absences_injustifiees FOR ALL TO authenticated USING (true) WITH CHECK (true);
