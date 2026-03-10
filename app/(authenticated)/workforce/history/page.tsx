import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { HistoryClient } from "./history-client";

export default async function HistoryPage() {
  const supabase = await createClient();

  const [employees, absences, salaryStats] = await Promise.all([
    fetchAll(supabase.from("wp_employees").select("code_salarie, date_entree, date_sortie, vehicle_type, taux_occupation, est_sortie_temporaire, description_motif_sortie, description_departement")),
    fetchAll(supabase.from("wp_absences").select("code_salarie, mois, annee, pct_absenteisme, hrs_maladie, hrs_maternite, hrs_accident, hrs_raisons_familiales, hrs_conge_accompagnement, heures_theoriques")),
    fetchAll(supabase.from("wp_salary_stats").select("code_salarie, mois, annee, etp, hrs_base, hrs_supp")),
  ]);

  if (!employees || employees.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Analyse historique</h1>
          <p className="text-muted-foreground">Tendances sur 2 ans : absentéisme, turnover, départs.</p>
        </div>
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12">
          <p className="text-lg font-medium">Aucune donnée disponible</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Importez vos fichiers RH historiques pour visualiser les tendances.
          </p>
        </div>
      </div>
    );
  }

  // Detect available years from data
  const absYears = [...new Set((absences || []).map((a) => Number(a.annee)))].sort();
  const salaryYears = [...new Set((salaryStats || []).map((s) => Number(s.annee)))].sort();
  const employeeYears: number[] = [];
  (employees || []).forEach((e) => {
    if (e.date_entree) employeeYears.push(new Date(e.date_entree).getFullYear());
    if (e.date_sortie) employeeYears.push(new Date(e.date_sortie).getFullYear());
  });
  const allYears = [...new Set([...absYears, ...salaryYears, ...employeeYears])].filter((y) => y > 2000).sort();

  // ============================================================
  // 1. Monthly absenteeism by year (for seasonal overlay)
  // ============================================================
  const absenteeismByYearMonth: Record<number, Record<number, { total: number; count: number }>> = {};
  (absences || []).forEach((a) => {
    const yr = Number(a.annee);
    const mo = Number(a.mois);
    if (!absenteeismByYearMonth[yr]) absenteeismByYearMonth[yr] = {};
    if (!absenteeismByYearMonth[yr][mo]) absenteeismByYearMonth[yr][mo] = { total: 0, count: 0 };
    absenteeismByYearMonth[yr][mo].total += Number(a.pct_absenteisme);
    absenteeismByYearMonth[yr][mo].count++;
  });

  const absenteeismSeries = absYears.map((yr) => ({
    year: yr,
    data: Array.from({ length: 12 }, (_, i) => {
      const entry = absenteeismByYearMonth[yr]?.[i + 1];
      return {
        mois: i + 1,
        avg_rate: entry ? entry.total / entry.count : null,
      };
    }),
  }));

  // ============================================================
  // 2. Absence type breakdown (aggregate across all data)
  // ============================================================
  const absTypeAgg = { maladie: 0, accident: 0, maternite: 0, raisons_fam: 0, accompagnement: 0 };
  (absences || []).forEach((a) => {
    absTypeAgg.maladie += Number(a.hrs_maladie || 0);
    absTypeAgg.accident += Number(a.hrs_accident || 0);
    absTypeAgg.maternite += Number(a.hrs_maternite || 0);
    absTypeAgg.raisons_fam += Number(a.hrs_raisons_familiales || 0);
    absTypeAgg.accompagnement += Number(a.hrs_conge_accompagnement || 0);
  });

  const absTypeData = [
    { type: "Maladie", hours: Math.round(absTypeAgg.maladie) },
    { type: "Accident", hours: Math.round(absTypeAgg.accident) },
    { type: "Maternité", hours: Math.round(absTypeAgg.maternite) },
    { type: "Raisons fam.", hours: Math.round(absTypeAgg.raisons_fam) },
    { type: "Accompagnement", hours: Math.round(absTypeAgg.accompagnement) },
  ].filter((d) => d.hours > 0);

  // ============================================================
  // 3. Turnover by year
  // ============================================================
  const turnoverByYear = allYears.map((yr) => {
    const yearStart = `${yr}-01-01`;
    const yearEnd = `${yr}-12-31`;

    const activeAtStart = (employees || []).filter((e) => {
      if (!e.date_entree || e.date_entree > yearStart) return false;
      if (e.date_sortie && e.date_sortie < yearStart) return false;
      return true;
    }).length;

    const departures = (employees || []).filter((e) => {
      if (!e.date_sortie) return false;
      return e.date_sortie >= yearStart && e.date_sortie <= yearEnd;
    }).length;

    const arrivals = (employees || []).filter((e) => {
      if (!e.date_entree) return false;
      return e.date_entree >= yearStart && e.date_entree <= yearEnd;
    }).length;

    const rate = activeAtStart > 0 ? (departures / activeAtStart) * 100 : 0;

    return { year: yr, effectif: activeAtStart, departures, arrivals, rate: Math.round(rate * 10) / 10 };
  }).filter((d) => d.effectif > 0);

  // ============================================================
  // 4. Departure motifs breakdown
  // ============================================================
  const motifCounts: Record<string, number> = {};
  (employees || []).forEach((e) => {
    if (!e.date_sortie || !e.description_motif_sortie) return;
    const motif = e.description_motif_sortie;
    motifCounts[motif] = (motifCounts[motif] || 0) + 1;
  });

  const motifData = Object.entries(motifCounts)
    .map(([motif, count]) => ({ motif, count }))
    .sort((a, b) => b.count - a.count);

  // ============================================================
  // 5. Monthly headcount evolution across years
  // ============================================================
  const headcountByYearMonth = allYears.map((yr) => ({
    year: yr,
    data: Array.from({ length: 12 }, (_, i) => {
      const monthDate = `${yr}-${String(i + 1).padStart(2, "0")}-28`;
      const monthStart = `${yr}-${String(i + 1).padStart(2, "0")}-01`;
      const count = (employees || []).filter((e) => {
        if (!e.date_entree || e.date_entree > monthDate) return false;
        if (e.date_sortie && e.date_sortie < monthStart) return false;
        return true;
      }).length;
      return { mois: i + 1, count };
    }),
  }));

  // ============================================================
  // 6. Suggested defaults for scenarios
  // ============================================================
  const avgAbsByMonth: Record<number, number> = {};
  for (let m = 1; m <= 12; m++) {
    const entries = (absences || []).filter((a) => Number(a.mois) === m);
    avgAbsByMonth[m] = entries.length > 0
      ? entries.reduce((sum, a) => sum + Number(a.pct_absenteisme), 0) / entries.length
      : 5;
  }

  const avgTurnover = turnoverByYear.length > 0
    ? turnoverByYear.reduce((sum, t) => sum + t.rate, 0) / turnoverByYear.length
    : 5;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Analyse historique</h1>
        <p className="text-muted-foreground">
          Tendances sur {allYears.length} année(s) : {allYears[0]}–{allYears[allYears.length - 1]}
        </p>
      </div>
      <HistoryClient
        absenteeismSeries={absenteeismSeries}
        absTypeData={absTypeData}
        turnoverByYear={turnoverByYear}
        motifData={motifData}
        headcountByYearMonth={headcountByYearMonth}
        suggestedAbsenteeism={avgAbsByMonth}
        suggestedTurnover={Math.round(avgTurnover * 10) / 10}
        years={allYears}
      />
    </div>
  );
}
