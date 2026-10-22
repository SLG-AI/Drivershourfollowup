-- Année des scénarios de besoins cibles : leurs valeurs sont par mois et par
-- dépôt, mais rien ne disait de quelle année. Sans elle, impossible de les
-- comparer à l'effectif d'une année (analyste IA, écart à la cible).
-- Les scénarios existants prennent l'année de leur création.
ALTER TABLE wp_target_scenarios ADD COLUMN IF NOT EXISTS annee INT;
UPDATE wp_target_scenarios SET annee = EXTRACT(YEAR FROM COALESCE(created_at, now()))::INT WHERE annee IS NULL;
ALTER TABLE wp_target_scenarios
  ALTER COLUMN annee SET DEFAULT EXTRACT(YEAR FROM now())::INT,
  ALTER COLUMN annee SET NOT NULL,
  ADD CONSTRAINT wp_target_scenarios_annee_check CHECK (annee BETWEEN 2020 AND 2100);
