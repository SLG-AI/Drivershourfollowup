-- Agrégation mensuelle des heures (page Analytique).
-- Présente en prod depuis l'origine mais créée hors migrations (éditeur SQL) :
-- une base neuve ne l'avait pas, et l'appel RPC échouait en silence ⇒ graphique à 0.
-- Définition recopiée telle quelle depuis la prod.
CREATE OR REPLACE FUNCTION public.get_monthly_aggregation(p_period_ids uuid[], p_vehicle_type text DEFAULT NULL::text)
 RETURNS TABLE(month integer, year integer, sum_counter_end numeric, sum_overtime_pay numeric, sum_missing_hours numeric, sum_positive_hours numeric, count_drivers bigint)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    mr.month,
    mr.year,
    SUM(mr.counter_end) AS sum_counter_end,
    SUM(mr.overtime_pay) AS sum_overtime_pay,
    SUM(mr.missing_hours) AS sum_missing_hours,
    SUM(CASE WHEN mr.positive_hours <= 200 THEN mr.positive_hours ELSE 0 END) AS sum_positive_hours,
    COUNT(*) AS count_drivers
  FROM monthly_records mr
  JOIN drivers d ON d.id = mr.driver_id
  WHERE mr.period_id = ANY(p_period_ids)
    AND (p_vehicle_type IS NULL OR d.vehicle_type = p_vehicle_type)
  GROUP BY mr.year, mr.month
  ORDER BY mr.year, mr.month;
$function$;
