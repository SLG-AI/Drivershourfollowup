-- ============================================================================
--  LEVIERS DE COÛT D'UN SCÉNARIO
-- ----------------------------------------------------------------------------
--  Une ligne = un levier daté (année/mois d'effet), global (centre_cout NULL)
--  ou propre à un cost center :
--    indexation / augmentation : hausse en % du brut plein temps, cumulée
--                                multiplicativement avec les tranches
--                                antérieures effectives ;
--    ssm                       : plancher de brut plein temps (salaire social
--                                minimum) relevé par les hausses postérieures ;
--    coefficient               : coefficient de charges forcé, prime sur le
--                                coefficient calculé ;
--    prime                     : montant ponctuel du mois d'effet, global ou
--                                par ETP payé.
--  Le mode précise l'unité de `valeur` et découle du type (contrainte).
-- ============================================================================

CREATE TABLE IF NOT EXISTS wp_scenario_cost_params (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id UUID NOT NULL REFERENCES wp_scenarios(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('indexation', 'augmentation', 'ssm', 'coefficient', 'prime')),
  centre_cout TEXT,
  annee_effet INT NOT NULL,
  mois_effet INT NOT NULL CHECK (mois_effet BETWEEN 1 AND 12),
  valeur NUMERIC NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('pct', 'seuil_etp', 'coef', 'montant_global', 'montant_etp')),
  libelle TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT wp_scenario_cost_params_type_mode CHECK (
    (type IN ('indexation', 'augmentation') AND mode = 'pct')
    OR (type = 'ssm' AND mode = 'seuil_etp')
    OR (type = 'coefficient' AND mode = 'coef')
    OR (type = 'prime' AND mode IN ('montant_global', 'montant_etp'))
  )
);

COMMENT ON TABLE wp_scenario_cost_params IS
  'Leviers de coût datés d''un scénario de projection (indexation, augmentation, SSM, coefficient de charges forcé, prime), globaux ou par cost center.';
COMMENT ON COLUMN wp_scenario_cost_params.type IS
  'indexation | augmentation (hausse en % du brut) | ssm (plancher de brut plein temps) | coefficient (coefficient de charges forcé) | prime (montant ponctuel)';
COMMENT ON COLUMN wp_scenario_cost_params.centre_cout IS
  'Cost center visé, NULL = levier global (s''applique à tous les cost centers)';
COMMENT ON COLUMN wp_scenario_cost_params.mode IS
  'Unité de valeur, imposée par le type : pct (indexation/augmentation), seuil_etp (ssm), coef (coefficient), montant_global ou montant_etp (prime)';
COMMENT ON COLUMN wp_scenario_cost_params.valeur IS
  'Selon le mode : pct = % de hausse, seuil_etp = € brut plein temps par mois, coef = coefficient de charges (ex. 1.35), montant_global = € pour le mois, montant_etp = € par ETP payé pour le mois';

CREATE INDEX IF NOT EXISTS idx_cost_params_scenario ON wp_scenario_cost_params(scenario_id);

-- Un même levier (type, effet, périmètre, libellé) ne peut être saisi qu'une fois par scénario
CREATE UNIQUE INDEX IF NOT EXISTS wp_scenario_cost_params_uniq
  ON wp_scenario_cost_params (scenario_id, type, annee_effet, mois_effet, COALESCE(centre_cout, '__GLOBAL__'), COALESCE(libelle, ''));

ALTER TABLE wp_scenario_cost_params ENABLE ROW LEVEL SECURITY;

-- Même politique que les tables sœurs d'hypothèses (20260316000004)
DROP POLICY IF EXISTS "Authenticated users can manage cost params" ON wp_scenario_cost_params;
CREATE POLICY "Authenticated users can manage cost params"
  ON wp_scenario_cost_params FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Les default privileges de 20260824000000 couvrent déjà les tables neuves ;
-- GRANT explicite malgré tout pour qu'une base rejouée dans un autre ordre
-- (ou par un autre rôle) reste utilisable.
GRANT SELECT, INSERT, UPDATE, DELETE ON wp_scenario_cost_params TO authenticated, service_role;
