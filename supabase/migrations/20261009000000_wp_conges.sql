-- ============================================================
-- Congés pris (export MCT « Recherche absences »)
-- ============================================================
-- L'export MCT porte aussi les congés : CONGES (congés) et CDEMEN / CGDEC /
-- CNOCES / RECUP (congés extraordinaires et récupération). Ils ne sont pas de
-- l'absentéisme : on les range ici, à part de wp_absences_mct, que sept
-- lecteurs consomment sans filtrer la prestation.
--
-- « Motif absence » n'est volontairement PAS conservé : texte libre saisi par
-- les salariés, parfois très personnel.

CREATE TABLE IF NOT EXISTS wp_conges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_salarie TEXT NOT NULL,
  nom_salarie TEXT,
  equipe TEXT,
  prestation TEXT NOT NULL,
  categorie TEXT NOT NULL CHECK (categorie IN ('conges', 'extraordinaire')),
  date_conge DATE NOT NULL,
  duree_hrs NUMERIC DEFAULT 0,
  mois INTEGER NOT NULL CHECK (mois BETWEEN 1 AND 12),
  annee INTEGER NOT NULL,
  import_id UUID REFERENCES wp_imports(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wp_conges_code ON wp_conges(code_salarie);
CREATE INDEX IF NOT EXISTS idx_wp_conges_period ON wp_conges(annee, mois);
CREATE INDEX IF NOT EXISTS idx_wp_conges_import ON wp_conges(import_id);

ALTER TABLE wp_conges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can manage wp_conges" ON wp_conges;
CREATE POLICY "Authenticated users can manage wp_conges"
  ON wp_conges FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Explicite (voir 20260824000000_explicit_table_grants.sql) : rien pour anon.
GRANT SELECT, INSERT, UPDATE, DELETE ON wp_conges TO authenticated, service_role;

-- Les congés des chauffeurs arrivent plus tard dans le mois que ceux des
-- services supports : un mois n'est mesuré qu'une fois cette case cochée à
-- l'import MCT. Sans elle, ses congés sont tracés comme partiels.
ALTER TABLE wp_imports
  ADD COLUMN IF NOT EXISTS conges_chauffeurs_inclus BOOLEAN NOT NULL DEFAULT false;

-- Rétention RGPD : même règle que les autres tables nominatives mensuelles.
CREATE OR REPLACE FUNCTION purge_expired_hr_data(retention_years INT DEFAULT 3)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cutoff         DATE := (date_trunc('month', current_date)
                          - make_interval(years => retention_years))::date;
  d_absences     INT;
  d_mct          INT;
  d_inj          INT;
  d_salary       INT;
  d_salary_lines INT;
  d_mouvements   INT;
  d_conges       INT;
  result         JSONB;
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

  DELETE FROM wp_salary_lines
    WHERE make_date(annee, mois, 1) < cutoff;
  GET DIAGNOSTICS d_salary_lines = ROW_COUNT;

  DELETE FROM wp_mouvements
    WHERE make_date(annee, mois, 1) < cutoff;
  GET DIAGNOSTICS d_mouvements = ROW_COUNT;

  DELETE FROM wp_conges
    WHERE make_date(annee, mois, 1) < cutoff;
  GET DIAGNOSTICS d_conges = ROW_COUNT;

  result := jsonb_build_object(
    'wp_absences',              d_absences,
    'wp_absences_mct',          d_mct,
    'wp_absences_injustifiees', d_inj,
    'wp_salary_stats',          d_salary,
    'wp_salary_lines',          d_salary_lines,
    'wp_mouvements',            d_mouvements,
    'wp_conges',                d_conges
  );

  INSERT INTO wp_retention_log (cutoff_date, deleted) VALUES (cutoff, result);
  RETURN result;
END;
$$;
