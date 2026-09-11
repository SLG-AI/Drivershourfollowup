-- ============================================================================
--  MOUVEMENTS DU PERSONNEL (export SIRH « Statistiques rapides IN/OUT »)
-- ----------------------------------------------------------------------------
--  L'export roster ne reconduit pas les salariés déjà sortis à la date de
--  l'export : un départ en cours de mois y est invisible, et la photo du mois
--  précédent ne connaît que la date de sortie PRÉVUE (fin de CDD…). Cet export
--  liste les entrées, sorties et sorties temporaires d'une période avec leur
--  date et leur motif RÉELS : il date les « disparus du roster » et complète
--  le tableau des mouvements.
--
--  Une ligne = un mouvement. La période (mois, annee) est celle de la date du
--  mouvement ; un import remplace les périodes qu'il contient.
-- ============================================================================

ALTER TABLE wp_imports DROP CONSTRAINT IF EXISTS wp_imports_file_type_check;
ALTER TABLE wp_imports ADD CONSTRAINT wp_imports_file_type_check
  CHECK (file_type IN ('roster_rh', 'salary_stats', 'absences_cns', 'absences_mct', 'absences_injustifiees', 'mouvements'));

CREATE TABLE IF NOT EXISTS wp_mouvements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_salarie TEXT NOT NULL,
  nom_salarie TEXT,
  equipe TEXT,
  type TEXT NOT NULL CHECK (type IN ('entree', 'sortie', 'sortie_temporaire')),
  date_entree DATE,
  date_sortie DATE,
  motif_sortie TEXT,
  mois SMALLINT NOT NULL CHECK (mois BETWEEN 1 AND 12),
  annee SMALLINT NOT NULL,
  import_id UUID REFERENCES wp_imports(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE wp_mouvements IS
  'Entrées / sorties / sorties temporaires constatées par le SIRH (export StatRapides IN/OUT). Période = mois de la date du mouvement.';

CREATE INDEX IF NOT EXISTS idx_wp_mouvements_code    ON wp_mouvements(code_salarie);
CREATE INDEX IF NOT EXISTS idx_wp_mouvements_periode ON wp_mouvements(annee, mois);
CREATE INDEX IF NOT EXISTS idx_wp_mouvements_import  ON wp_mouvements(import_id);

ALTER TABLE wp_mouvements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can manage wp_mouvements" ON wp_mouvements;
CREATE POLICY "Authenticated users can manage wp_mouvements"
  ON wp_mouvements FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Rétention RGPD : même règle que les autres tables nominatives mensuelles.
CREATE OR REPLACE FUNCTION purge_expired_hr_data(retention_years INT DEFAULT 3)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cutoff       DATE := (date_trunc('month', current_date)
                        - make_interval(years => retention_years))::date;
  d_absences   INT;
  d_mct        INT;
  d_inj        INT;
  d_salary     INT;
  d_mouvements INT;
  result       JSONB;
BEGIN
  DELETE FROM wp_absences
    WHERE make_date(annee, mois, 1) < cutoff;
  GET DIAGNOSTICS d_absences = ROW_COUNT;

  DELETE FROM wp_absences_mct
    WHERE make_date(annee, mois, 1) < cutoff;
  GET DIAGNOSTICS d_mct = ROW_COUNT;

  DELETE FROM wp_absences_injustifiees
    WHERE make_date(annee, mois, 1) < cutoff;
  GET DIAGNOSTICS d_inj = ROW_COUNT;

  DELETE FROM wp_salary_stats
    WHERE make_date(annee, mois, 1) < cutoff;
  GET DIAGNOSTICS d_salary = ROW_COUNT;

  DELETE FROM wp_mouvements
    WHERE make_date(annee, mois, 1) < cutoff;
  GET DIAGNOSTICS d_mouvements = ROW_COUNT;

  result := jsonb_build_object(
    'wp_absences',              d_absences,
    'wp_absences_mct',          d_mct,
    'wp_absences_injustifiees', d_inj,
    'wp_salary_stats',          d_salary,
    'wp_mouvements',            d_mouvements
  );

  INSERT INTO wp_retention_log (cutoff_date, deleted) VALUES (cutoff, result);
  RETURN result;
END;
$$;
