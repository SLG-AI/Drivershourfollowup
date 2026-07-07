-- ============================================================================
--  APERÇU RÉTENTION (DRY-RUN)  —  ne supprime rien
-- ----------------------------------------------------------------------------
--  Montre combien de lignes seraient purgées par purge_expired_hr_data(3),
--  c.-à-d. les données dont la période (annee, mois) est antérieure au
--  seuil « il y a 3 ans ». À lancer AVANT d'activer / de déclencher la purge.
-- ============================================================================

WITH cutoff AS (
  SELECT (date_trunc('month', current_date) - interval '3 years')::date AS d
)
SELECT 'wp_absences'              AS table_name,
       (SELECT d FROM cutoff)     AS seuil_purge,
       count(*)                   AS lignes_a_purger
FROM wp_absences, cutoff
WHERE make_date(annee, mois, 1) < cutoff.d
UNION ALL
SELECT 'wp_absences_mct', (SELECT d FROM cutoff), count(*)
FROM wp_absences_mct, cutoff
WHERE make_date(annee, mois, 1) < cutoff.d
UNION ALL
SELECT 'wp_absences_injustifiees', (SELECT d FROM cutoff), count(*)
FROM wp_absences_injustifiees, cutoff
WHERE make_date(annee, mois, 1) < cutoff.d
UNION ALL
SELECT 'wp_salary_stats', (SELECT d FROM cutoff), count(*)
FROM wp_salary_stats, cutoff
WHERE make_date(annee, mois, 1) < cutoff.d
ORDER BY table_name;
