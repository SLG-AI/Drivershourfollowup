-- ============================================================================
--  RÉTENTION AUTOMATIQUE DES DONNÉES RH  —  3 ans glissants
-- ----------------------------------------------------------------------------
--  Objectif GDPR (Art. 5-1-e, limitation de conservation) : purger
--  automatiquement les données personnelles / de santé / de salaire dès
--  qu'elles dépassent la durée de conservation retenue (3 ans).
--
--  Périmètre : tables time-series indexées par (annee, mois) :
--    wp_absences, wp_absences_mct, wp_absences_injustifiees, wp_salary_stats
--  Hors périmètre : wp_employees (roster en full-replace à chaque import,
--  ne cumule pas d'historique) et le domaine « heures » (monthly_records…)
--  qui fera l'objet d'une extension une fois son schéma confirmé.
--
--  Idempotent : réexécutable sans effet de bord (create ... if not exists,
--  create or replace, cron.schedule upsert par nom de job).
-- ============================================================================

-- 1. Extension de planification
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Journal des purges (traçabilité NIS2 + vérification du bon fonctionnement)
CREATE TABLE IF NOT EXISTS wp_retention_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  cutoff_date DATE NOT NULL,
  deleted     JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE wp_retention_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read retention log" ON wp_retention_log;
CREATE POLICY "Authenticated users can read retention log"
  ON wp_retention_log FOR SELECT TO authenticated USING (true);

-- 3. Fonction de purge. SECURITY DEFINER : tourne avec les droits du
--    propriétaire (postgres) pour pouvoir supprimer indépendamment de la RLS.
CREATE OR REPLACE FUNCTION purge_expired_hr_data(retention_years INT DEFAULT 3)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cutoff     DATE := (date_trunc('month', current_date)
                      - make_interval(years => retention_years))::date;
  d_absences INT;
  d_mct      INT;
  d_inj      INT;
  d_salary   INT;
  result     JSONB;
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

  result := jsonb_build_object(
    'wp_absences',              d_absences,
    'wp_absences_mct',          d_mct,
    'wp_absences_injustifiees', d_inj,
    'wp_salary_stats',          d_salary
  );

  INSERT INTO wp_retention_log (cutoff_date, deleted) VALUES (cutoff, result);
  RETURN result;
END;
$$;

-- 4. Planification : le 1er de chaque mois à 03:00 (heure serveur / UTC).
--    cron.schedule est un upsert par nom de job → rejouable sans doublon.
SELECT cron.schedule(
  'purge-expired-hr-data',
  '0 3 1 * *',
  $$ SELECT purge_expired_hr_data(3); $$
);

-- ----------------------------------------------------------------------------
--  NOTE : cette migration installe le mécanisme mais NE purge PAS immédiatement.
--  Le premier nettoyage aura lieu au prochain déclenchement du cron.
--  Pour purger tout de suite (après avoir vérifié l'aperçu), lance à la main :
--      SELECT purge_expired_hr_data(3);
-- ============================================================================
