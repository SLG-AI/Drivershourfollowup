/**
 * Essai des outils d'analyse sur la base LOCALE (clé de service locale).
 * Usage : SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/essai-outils.ts
 */
import { createClient } from "@supabase/supabase-js";
import { chargerDonnees } from "../lib/analyses/donnees";
import * as o from "../lib/analyses/outils";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
if (!url.includes("127.0.0.1") && !url.includes("localhost")) throw new Error("Essai réservé à la base locale.");

(async () => {
  const t0 = Date.now();
  const d = await chargerDonnees(createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!));
  console.log(`chargement ${Date.now() - t0} ms — paie ${d.paie.length}, heures ${d.heures.length}`);
  const sorties: Record<string, unknown> = {
    data_coverage: o.couvertureDonnees(d),
    long_days_by_depot: o.journeesLonguesParDepot(d, { activity_year: 2026, activity_month: 7 }),
    long_days_trend: o.tendanceJourneesLongues(d),
    extra_days_by_depot: o.sixiemesJoursParDepot(d, { year: 2026, period: 2 }),
    extra_days_trend: o.tendanceSixiemesJours(d),
    hours_by_depot: o.heuresParDepot(d, { year: 2026, month: 8 }),
    concentration_long_days: o.concentrationCharge(d, { indicator: "long_days", year: 2026, month_or_period: 7, threshold: 10 }),
    concentration_extra_days: o.concentrationCharge(d, { indicator: "extra_days", year: 2026, month_or_period: 2, by_depot: false }),
    absenteeism_by_depot: o.absenteismeParDepot(d, { year: 2026 }),
    turnover_by_depot: o.departsParDepot(d, { year: 2026 }),
  };
  for (const [nom, s] of Object.entries(sorties)) {
    const json = JSON.stringify(s);
    console.log(`\n## ${nom} — ${json.length} caractères`);
    console.log(JSON.stringify(s, null, 1).slice(0, Number(process.env.APERCU ?? 1500)));
  }
})();
