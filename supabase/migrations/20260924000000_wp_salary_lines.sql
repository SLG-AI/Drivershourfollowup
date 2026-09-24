-- ============================================================================
--  LISTE DES SALAIRES (export paie « Liste des salaires », StatAvecCS)
-- ----------------------------------------------------------------------------
--  Les Statistiques rapides (wp_salary_stats) donnent les heures, l'ETP et un
--  bloc « Suppléments ». La Liste des salaires décompose le brut en natures
--  (nuit, dimanche, amplitudes, heures sup., primes, régularisations…), porte
--  les cotisations patronales par nature et le coût employeur tel que la paie
--  le calcule (« Coût natures déduites » = total brut + charges patronales −
--  avantages en nature). Les deux exports sont deux SOURCES : cette table ne
--  remplace pas wp_salary_stats, les modules de coût la préfèrent quand la
--  période y est.
--
--  Une ligne = un salarié, un mois, un type de rémunération. Le SIRH ajoute
--  pour certains salariés une seconde ligne « Rémun. np » (période 13) :
--  rémunération non périodique, en pratique le décompte de congés versé à la
--  sortie. Elle est rattachée au mois de l'export, marquée non_periodique,
--  hors masse salariale courante mais comptée dans le coût réel du mois.
--
--  Ne sont PAS importés (décision utilisateur, 22/09 et 24/09/2026) : nom et
--  prénom, département, net, impôts, cotisations salariales, chèques repas,
--  frais, solde à virer.
-- ============================================================================

ALTER TABLE wp_imports DROP CONSTRAINT IF EXISTS wp_imports_file_type_check;
ALTER TABLE wp_imports ADD CONSTRAINT wp_imports_file_type_check
  CHECK (file_type IN ('roster_rh', 'salary_stats', 'absences_cns', 'absences_mct', 'absences_injustifiees', 'mouvements', 'salary_lines'));

CREATE TABLE IF NOT EXISTS wp_salary_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_salarie TEXT NOT NULL,
  mois SMALLINT NOT NULL CHECK (mois BETWEEN 1 AND 12),
  annee SMALLINT NOT NULL,
  type_remuneration TEXT NOT NULL DEFAULT 'salaire' CHECK (type_remuneration IN ('salaire', 'non_periodique')),
  centre_cout TEXT,
  fonction TEXT,
  -- Temps payé en % du plein temps (« Tâche en % »)
  tache_pct NUMERIC DEFAULT 0,

  brut_base NUMERIC DEFAULT 0,
  -- Natures (voir lib/utils/wp-natures-paie.ts pour le classement en familles).
  -- nat_cct cumule les codes CCT et P001 : même complément de salaire (13e mois proratisé).
  nat_abin NUMERIC DEFAULT 0,
  nat_aj NUMERIC DEFAULT 0,
  nat_all NUMERIC DEFAULT 0,
  nat_am1 NUMERIC DEFAULT 0,
  nat_am2 NUMERIC DEFAULT 0,
  nat_cct NUMERIC DEFAULT 0,
  nat_cgtp NUMERIC DEFAULT 0,
  nat_dc NUMERIC DEFAULT 0,
  nat_e002 NUMERIC DEFAULT 0,
  nat_g001 NUMERIC DEFAULT 0,
  nat_hfm NUMERIC DEFAULT 0,
  nat_hsm NUMERIC DEFAULT 0,
  nat_n002 NUMERIC DEFAULT 0,
  nat_perm NUMERIC DEFAULT 0,
  nat_pr_d NUMERIC DEFAULT 0,
  nat_pr_f NUMERIC DEFAULT 0,
  nat_prim NUMERIC DEFAULT 0,
  nat_prr NUMERIC DEFAULT 0,
  nat_shd NUMERIC DEFAULT 0,
  nat_shn NUMERIC DEFAULT 0,
  nat_smg NUMERIC DEFAULT 0,
  nat_autres_cs NUMERIC DEFAULT 0,
  total_brut NUMERIC DEFAULT 0,

  -- Cotisations patronales
  cm_patronale_soins NUMERIC DEFAULT 0,
  cm_patronale_especes NUMERIC DEFAULT 0,
  cm_patronale NUMERIC DEFAULT 0,
  cp_patronale NUMERIC DEFAULT 0,
  assurance_accident NUMERIC DEFAULT 0,
  sante_travail NUMERIC DEFAULT 0,
  mutualite NUMERIC DEFAULT 0,
  cot_pat_autres NUMERIC DEFAULT 0,
  charges_patronales NUMERIC DEFAULT 0,
  -- Avantages en nature déduits du coût = total_brut + charges_patronales − cout_employeur
  avantages_nature NUMERIC DEFAULT 0,
  -- « Coût natures déduites » : le coût employeur tel que la paie le calcule
  cout_employeur NUMERIC DEFAULT 0,

  import_id UUID REFERENCES wp_imports(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT wp_salary_lines_code_periode_type_uniq UNIQUE (code_salarie, annee, mois, type_remuneration)
);

COMMENT ON TABLE wp_salary_lines IS
  'Liste des salaires (export paie StatAvecCS) : brut décomposé par nature, cotisations patronales, coût employeur. Une ligne par salarié, mois et type de rémunération.';
COMMENT ON COLUMN wp_salary_lines.type_remuneration IS
  'salaire = paie du mois ; non_periodique = ligne « Rémun. np » (période 13 du SIRH), en pratique un décompte de congés à la sortie.';
COMMENT ON COLUMN wp_salary_lines.cout_employeur IS
  'Colonne « Coût natures déduites » du fichier = total_brut + charges_patronales − avantages_nature.';

CREATE INDEX IF NOT EXISTS idx_wp_salary_lines_periode ON wp_salary_lines(annee, mois);
CREATE INDEX IF NOT EXISTS idx_wp_salary_lines_cc ON wp_salary_lines(centre_cout);
CREATE INDEX IF NOT EXISTS idx_wp_salary_lines_import ON wp_salary_lines(import_id);

ALTER TABLE wp_salary_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can manage wp_salary_lines" ON wp_salary_lines;
CREATE POLICY "Authenticated users can manage wp_salary_lines"
  ON wp_salary_lines FOR ALL TO authenticated USING (true) WITH CHECK (true);

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

  result := jsonb_build_object(
    'wp_absences',              d_absences,
    'wp_absences_mct',          d_mct,
    'wp_absences_injustifiees', d_inj,
    'wp_salary_stats',          d_salary,
    'wp_salary_lines',          d_salary_lines,
    'wp_mouvements',            d_mouvements
  );

  INSERT INTO wp_retention_log (cutoff_date, deleted) VALUES (cutoff, result);
  RETURN result;
END;
$$;
