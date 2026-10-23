-- ============================================================================
--  COÛTS INTÉRIM (export « Coûts » de SLG Intérim)
-- ----------------------------------------------------------------------------
--  SLG Intérim calcule le coût ATTENDU de chaque intérimaire (heures × taux,
--  majorations, amplitudes, × coefficient de l'agence) et l'exporte, une ligne
--  par intérimaire, mois et composante. Le dépôt et le cost center ne viennent
--  PAS de ce fichier : ils sont lus dans le roster HRIS du même mois, où les
--  intérimaires portent un type de contrat dédié.
--
--  Ces lignes intérim du roster sont rangées à part (wp_interim_roster) et
--  jamais dans wp_employees : effectifs, ETP, turnover, absentéisme et
--  valorisation de la paie ne les voient pas, ce qui évite un double compte.
--
--  Ne sont PAS importés (décision utilisateur, 16/10/2026) : nom de
--  l'intérimaire, n° interne, n° ratio, ni aucune coordonnée. La clé est le
--  code salarié.
-- ============================================================================

ALTER TABLE wp_imports DROP CONSTRAINT IF EXISTS wp_imports_file_type_check;
ALTER TABLE wp_imports ADD CONSTRAINT wp_imports_file_type_check
  CHECK (file_type IN ('roster_rh', 'salary_stats', 'absences_cns', 'absences_mct', 'absences_injustifiees', 'mouvements', 'salary_lines', 'interim_couts'));

CREATE TABLE IF NOT EXISTS wp_interim_roster (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_salarie TEXT NOT NULL,
  mois SMALLINT NOT NULL CHECK (mois BETWEEN 1 AND 12),
  annee SMALLINT NOT NULL,
  type_contrat TEXT,
  code_employeur TEXT,
  centre_cout TEXT,
  -- Dépôt, comme wp_employees.description_service
  description_service TEXT,
  -- Pour que les filtres fonction / équipe de l'en-tête s'appliquent aussi
  description_fonction TEXT,
  description_equipe TEXT,
  import_id UUID REFERENCES wp_imports(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT wp_interim_roster_code_periode_uniq UNIQUE (code_salarie, annee, mois)
);

COMMENT ON TABLE wp_interim_roster IS
  'Lignes intérim du roster HRIS (type de contrat intérim), écartées de wp_employees à l''import. Sert au rattachement dépôt / cost center des coûts intérim.';

CREATE TABLE IF NOT EXISTS wp_interim_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_salarie TEXT NOT NULL,
  mois SMALLINT NOT NULL CHECK (mois BETWEEN 1 AND 12),
  annee SMALLINT NOT NULL,
  agence TEXT,
  population TEXT,
  -- base, overtime, night, sunday, holiday, amplitude_11, amplitude_12, meal_voucher
  composante TEXT NOT NULL,
  quantite NUMERIC DEFAULT 0,
  unite TEXT,
  montant_avant_coefficient NUMERIC DEFAULT 0,
  coefficient NUMERIC,
  montant_facturable NUMERIC DEFAULT 0,
  import_id UUID REFERENCES wp_imports(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE wp_interim_costs IS
  'Coût attendu de l''intérim (export Coûts de SLG Intérim) : une ligne par intérimaire, mois et composante. Sans nom.';
COMMENT ON COLUMN wp_interim_costs.montant_facturable IS
  'Montant de la composante après coefficient de l''agence : ce que l''agence facture.';

CREATE INDEX IF NOT EXISTS idx_wp_interim_roster_periode ON wp_interim_roster(annee, mois);
CREATE INDEX IF NOT EXISTS idx_wp_interim_roster_import ON wp_interim_roster(import_id);
CREATE INDEX IF NOT EXISTS idx_wp_interim_costs_periode ON wp_interim_costs(annee, mois);
CREATE INDEX IF NOT EXISTS idx_wp_interim_costs_import ON wp_interim_costs(import_id);

ALTER TABLE wp_interim_roster ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can manage wp_interim_roster" ON wp_interim_roster;
CREATE POLICY "Authenticated users can manage wp_interim_roster"
  ON wp_interim_roster FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE wp_interim_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can manage wp_interim_costs" ON wp_interim_costs;
CREATE POLICY "Authenticated users can manage wp_interim_costs"
  ON wp_interim_costs FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON wp_interim_roster TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON wp_interim_costs TO authenticated, service_role;

-- Rétention RGPD : même règle que les autres tables mensuelles par salarié.
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
  d_interim_cost INT;
  d_interim_rost INT;
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

  DELETE FROM wp_interim_costs
    WHERE make_date(annee, mois, 1) < cutoff;
  GET DIAGNOSTICS d_interim_cost = ROW_COUNT;

  DELETE FROM wp_interim_roster
    WHERE make_date(annee, mois, 1) < cutoff;
  GET DIAGNOSTICS d_interim_rost = ROW_COUNT;

  result := jsonb_build_object(
    'wp_absences',              d_absences,
    'wp_absences_mct',          d_mct,
    'wp_absences_injustifiees', d_inj,
    'wp_salary_stats',          d_salary,
    'wp_salary_lines',          d_salary_lines,
    'wp_mouvements',            d_mouvements,
    'wp_conges',                d_conges,
    'wp_interim_costs',         d_interim_cost,
    'wp_interim_roster',        d_interim_rost
  );

  INSERT INTO wp_retention_log (cutoff_date, deleted) VALUES (cutoff, result);
  RETURN result;
END;
$$;
