-- ============================================================================
--  NETTOYAGE DES DONNÉES RH IMPORTÉES  —  ⚠️  PRODUCTION  ⚠️
-- ----------------------------------------------------------------------------
--  Vide toutes les données importées (PII / salaires / santé) MAIS conserve :
--    - le schéma (structure des tables)
--    - les scénarios, hypothèses et cibles (wp_scenarios, wp_target_*, etc.)
--
--  À LANCER MANUELLEMENT dans le SQL Editor de Supabase.
--  NE PAS placer dans supabase/migrations/ (serait rejoué à chaque déploiement).
--
--  Sécurité : le script tourne en transaction et se termine par ROLLBACK.
--  → Lance-le tel quel pour un DRY-RUN (rien n'est supprimé, tu vois les comptes).
--  → Quand tu es sûr, remplace la dernière ligne ROLLBACK par COMMIT.
-- ============================================================================

BEGIN;

-- Comptes AVANT (pour vérifier ce que tu t'apprêtes à effacer)
SELECT 'AVANT' AS phase, 'wp_imports'               AS table_name, count(*) FROM wp_imports
UNION ALL SELECT 'AVANT', 'wp_employees',              count(*) FROM wp_employees
UNION ALL SELECT 'AVANT', 'wp_salary_stats',           count(*) FROM wp_salary_stats
UNION ALL SELECT 'AVANT', 'wp_absences',               count(*) FROM wp_absences
UNION ALL SELECT 'AVANT', 'wp_absences_injustifiees',  count(*) FROM wp_absences_injustifiees
UNION ALL SELECT 'AVANT', 'wp_absences_mct',           count(*) FROM wp_absences_mct;

-- Nettoyage. TRUNCATE de wp_imports + CASCADE efface automatiquement les
-- 5 tables enfant (FK import_id ... ON DELETE CASCADE). On les liste quand même
-- explicitement pour que l'intention soit lisible et vérifiable.
TRUNCATE TABLE
  wp_imports,
  wp_employees,
  wp_salary_stats,
  wp_absences,
  wp_absences_injustifiees,
  wp_absences_mct
CASCADE;

-- Comptes APRÈS (doivent tous être à 0)
SELECT 'APRES' AS phase, 'wp_imports'               AS table_name, count(*) FROM wp_imports
UNION ALL SELECT 'APRES', 'wp_employees',              count(*) FROM wp_employees
UNION ALL SELECT 'APRES', 'wp_salary_stats',           count(*) FROM wp_salary_stats
UNION ALL SELECT 'APRES', 'wp_absences',               count(*) FROM wp_absences
UNION ALL SELECT 'APRES', 'wp_absences_injustifiees',  count(*) FROM wp_absences_injustifiees
UNION ALL SELECT 'APRES', 'wp_absences_mct',           count(*) FROM wp_absences_mct;

-- ⛔ DRY-RUN par défaut : rien n'est réellement supprimé.
-- Remplace ROLLBACK par COMMIT quand tu veux appliquer pour de vrai.
ROLLBACK;
-- COMMIT;
