import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { WpKpiCards, type WpDashboardStats } from "@/components/workforce/kpi-cards";
import { HeadcountEvolutionChart, type HeadcountDataPoint, type ScenarioOption, type ScenarioProjectionData } from "@/components/workforce/headcount-evolution-chart";
import { getArrivalsForMonth, getCddDeparturesForMonth, getWorkableHoursInMonth, type ArrivalHypothesis } from "@/lib/utils/wp-calculations";
import { DepartureTable, type DepartureItem } from "@/components/workforce/departure-table";
import { ArrivalTable, type ArrivalItem } from "@/components/workforce/arrival-table";
import { TempExitsTable, type TempExitItem } from "@/components/workforce/temp-exits-table";
import { BreakdownChart, type BreakdownByType, type BreakdownByDepot } from "@/components/workforce/breakdown-chart";
import { GapAnalysisChart, type GapDataPoint } from "@/components/workforce/gap-analysis-chart";
import { AbsenteeismTable, type AbsenteeismItem } from "@/components/workforce/absenteeism-table";
import { MctTable, type MctItem } from "@/components/workforce/mct-table";
import { InjustifieesTable, type InjustifieeItem } from "@/components/workforce/injustifiees-table";
import { FRENCH_MONTHS_SHORT } from "@/lib/constants";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";

const MONTH_LABELS: Record<number, string> = {
  1: "Janvier", 2: "Février", 3: "Mars", 4: "Avril",
  5: "Mai", 6: "Juin", 7: "Juillet", 8: "Août",
  9: "Septembre", 10: "Octobre", 11: "Novembre", 12: "Décembre",
};

function lastDayOfMonth(year: number, month: number): string {
  const d = new Date(year, month, 0);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}


interface Props {
  searchParams: Promise<{ year?: string; month?: string; fonctions?: string; cc?: string; depots?: string }>;
}

export default async function WorkforceDashboardPage({ searchParams }: Props) {
  const params = await searchParams;
  const supabase = await createClient();
  const now = new Date();
  const selectedYear = params.year ? parseInt(params.year) : now.getFullYear();
  const selectedMonth = params.month ? parseInt(params.month) : now.getMonth() + 1;
  const SEP = "|||";
  const selectedFonctions = params.fonctions === "__none__" ? ["__none__"] : (params.fonctions ? params.fonctions.split(SEP) : []);
  const selectedCC = params.cc === "__none__" ? ["__none__"] : (params.cc ? params.cc.split(SEP) : []);
  const selectedDepots = params.depots === "__none__" ? ["__none__"] : (params.depots ? params.depots.split(SEP) : []);

  // Reference date: last day of selected month
  const refDate = lastDayOfMonth(selectedYear, selectedMonth);

  // Check if we have any data
  const { count: employeeCount } = await supabase
    .from("wp_employees")
    .select("*", { count: "exact", head: true });

  if (!employeeCount || employeeCount === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Workforce Planning</h1>
          <p className="text-muted-foreground">
            Prévision et suivi des effectifs chauffeurs.
          </p>
        </div>
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12">
          <p className="text-lg font-medium">Aucune donnée disponible</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Importez vos fichiers RH pour commencer.
          </p>
          <Button asChild className="mt-4">
            <Link href="/workforce/import">
              <Upload className="mr-2 h-4 w-4" />
              Importer des données
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  // Fetch all data in parallel (paginated to avoid 1000-row limit)
  const [employees, absences, salaryStats, absencesMct, absencesInjustifiees, targets, defaultScenarios, allScenariosRaw] = await Promise.all([
    fetchAll(supabase.from("wp_employees").select("*")),
    fetchAll(supabase.from("wp_absences").select("*").eq("annee", selectedYear)),
    fetchAll(supabase.from("wp_salary_stats").select("*").eq("annee", selectedYear)),
    fetchAll(supabase.from("wp_absences_mct").select("*").eq("annee", selectedYear)),
    fetchAll(supabase.from("wp_absences_injustifiees").select("*").eq("annee", selectedYear)).then(r => { console.log("[DEBUG] absences_injustifiees for year", selectedYear, "count:", r.length, "sample:", r.slice(0, 2)); return r; }),
    fetchAll(supabase.from("wp_target_needs").select("*")),
    fetchAll(supabase.from("wp_scenarios").select("id, is_default").order("is_default", { ascending: false }).order("updated_at", { ascending: false })),
    fetchAll(supabase.from("wp_scenarios").select("id, name").order("created_at", { ascending: false })),
  ]);

  // Fetch scenario monthly params: prefer default, fallback to most recent
  const defaultScenarioId = defaultScenarios[0]?.id;
  const scenarioMonthlyParams = defaultScenarioId
    ? await fetchAll(
        supabase
          .from("wp_scenario_monthly_params")
          .select("mois, projected_absenteeism_rate, centre_cout")
          .eq("scenario_id", defaultScenarioId)
      )
    : [];
  // Global rates (centre_cout IS NULL)
  const scenarioAbsRateByMonth = new Map<number, number>();
  // Per-cost-center rates: Map<"mois:centre_cout", rate>
  const scenarioAbsRateByCc = new Map<string, number>();
  scenarioMonthlyParams.forEach((p) => {
    const mois = Number(p.mois);
    const rate = Number(p.projected_absenteeism_rate);
    if (p.centre_cout) {
      scenarioAbsRateByCc.set(`${mois}:${p.centre_cout}`, rate);
    } else {
      scenarioAbsRateByMonth.set(mois, rate);
    }
  });
  /** Get scenario absenteeism rate for a month+cost_center, with global fallback */
  const getScenarioAbsRate = (mois: number, centreCout?: string | null): number => {
    if (centreCout) {
      const specific = scenarioAbsRateByCc.get(`${mois}:${centreCout}`);
      if (specific !== undefined) return specific;
    }
    return scenarioAbsRateByMonth.get(mois) ?? 5;
  };

  // Apply fonction and cost center filters
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allEmployees = employees.filter((e: any) => {
    if (selectedFonctions.length > 0 && !selectedFonctions.includes(e.description_fonction || "")) return false;
    if (selectedCC.length > 0 && !selectedCC.includes(e.centre_cout || "")) return false;
    if (selectedDepots.length > 0 && !selectedDepots.includes(e.description_service || "")) return false;
    return true;
  });

  // Filter absences/salary stats to matching employees
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const employeeCodes = new Set(allEmployees.map((e: any) => e.code_salarie));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allAbsences = absences.filter((a: any) => employeeCodes.has(a.code_salarie));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allSalaryStats = salaryStats.filter((s: any) => employeeCodes.has(s.code_salarie));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allAbsencesMct = absencesMct.filter((a: any) => employeeCodes.size === 0 || employeeCodes.has(a.code_salarie));
  // No employee filter for absences injustifiées — include all employees even if not in roster
  const allAbsencesInjustifiees = absencesInjustifiees;
  const allTargets = targets;

  // ============================================================
  // Reclassification : les employés flaggés "sortie temporaire"
  // qui apparaissent dans le fichier CNS avec des heures maladie
  // et dont le motif n'est PAS un congé structurel sont reclassifiés
  // comme absents maladie (est_sortie_temporaire = false)
  // ============================================================

  const CONGES_STRUCTURELS = new Set([
    "Conge Parental TP",
    "Congé sans solde",
    "Congé de maternité",
    "Congé d'accompagnement",
  ]);

  // Codes des employés avec heures maladie dans le CNS (tous mois confondus pour l'année)
  const codesAvecMaladieCns = new Set(
    allAbsences
      .filter((a) => Number(a.hrs_maladie || 0) > 0)
      .map((a) => a.code_salarie)
  );

  // Reclassifier dans allEmployees
  allEmployees.forEach((e) => {
    if (
      e.est_sortie_temporaire &&
      !CONGES_STRUCTURELS.has(e.description_motif_sortie || "") &&
      codesAvecMaladieCns.has(e.code_salarie)
    ) {
      e.est_sortie_temporaire = false;
      e._reclassified_maladie = true;
    }
  });

  // ============================================================
  // Helper: employees active at a given date
  // Active = date_entree <= date (or null = unknown start, count them)
  //          AND (date_sortie IS NULL OR date_sortie >= date)
  // ============================================================
  const DEBUG_CODES = new Set(["SLA 1526", "SLA 2015", "SLA R0019"]);
  function getActiveEmployeesAt(date: string) {
    return allEmployees.filter((e) => {
      const isDebug = DEBUG_CODES.has(e.code_salarie);
      // If date_entree exists and is after the reference date, not yet hired
      if (e.date_entree && e.date_entree > date) return false;
      // If date_sortie exists and is before the reference date, already left
      // UNLESS the employee has an active temporary exit (e.g. maternity) that extends beyond
      if (e.date_sortie && e.date_sortie < date) {
        if (isDebug) console.log(`[DEBUG] ${e.code_salarie}: date_sortie=${e.date_sortie} < ${date}, est_sortie_temporaire=${e.est_sortie_temporaire}, date_fin_sortie_temporaire=${e.date_fin_sortie_temporaire}`);
        if (e.est_sortie_temporaire && e.date_fin_sortie_temporaire && e.date_fin_sortie_temporaire >= date) {
          if (isDebug) console.log(`[DEBUG] ${e.code_salarie}: RECOVERED ✓`);
          return true; // Still active due to ongoing temporary exit (congé maternité, etc.)
        }
        if (isDebug) console.log(`[DEBUG] ${e.code_salarie}: EXCLUDED ✗`);
        return false;
      }
      return true;
    });
  }

  // ============================================================
  // Calculate KPIs for selected month
  // ============================================================

  const activeEmployees = getActiveEmployeesAt(refDate);
  const headcount = activeEmployees.length;

  // ETP = taux_occupation / 100 (from wp_employees directly)
  function getEtp(e: Record<string, unknown>): number {
    return Number(e.taux_occupation || 100) / 100;
  }

  // Effectif brut in ETP
  const effectifBrutEtp = activeEmployees.reduce((sum, e) => sum + getEtp(e), 0);
  const busEtp = activeEmployees.filter((e) => e.vehicle_type === "BUS").reduce((sum, e) => sum + getEtp(e), 0);
  const camEtp = activeEmployees.filter((e) => e.vehicle_type === "CAM").reduce((sum, e) => sum + getEtp(e), 0);

  // Sorties temporaires in ETP
  const sortiesTemp = activeEmployees.filter((e) => e.est_sortie_temporaire);
  const sortiesTempEtp = sortiesTemp.reduce((sum, e) => sum + getEtp(e), 0);
  const sortiesTemporairesCount = sortiesTemp.length;

  // Liste détaillée des sorties temporaires actuelles
  const tempExitItems: TempExitItem[] = sortiesTemp
    .sort((a, b) =>
      (a.date_debut_sortie_temporaire || "").localeCompare(b.date_debut_sortie_temporaire || "")
    )
    .map((e) => ({
      code_salarie: e.code_salarie,
      vehicle_type: e.vehicle_type || "?",
      description_equipe: e.description_equipe || "",
      date_debut: e.date_debut_sortie_temporaire || "",
      date_fin: e.date_fin_sortie_temporaire || null,
      motif: e.description_motif_sortie || "Non spécifié",
      etp: Math.round(getEtp(e) * 10) / 10,
    }));

  // Effectif net in ETP = brut ETP - sorties temporaires ETP
  const effectifNetEtp = effectifBrutEtp - sortiesTempEtp;

  // ============================================================
  // Détail absentéisme pour le mois sélectionné
  // ============================================================

  const selectedMonthAbsences = allAbsences.filter((a) => Number(a.mois) === selectedMonth);
  const nonTempActiveAtRef = activeEmployees.filter((e) => !e.est_sortie_temporaire);
  const nonTempCodes = new Set(nonTempActiveAtRef.map((e) => e.code_salarie));
  const empEtpMap = new Map<string, number>();
  const empVehicleMap = new Map<string, string>();
  const empEquipeMap = new Map<string, string>();
  activeEmployees.forEach((e) => {
    empEtpMap.set(e.code_salarie, getEtp(e));
    empVehicleMap.set(e.code_salarie, e.vehicle_type || "?");
    empEquipeMap.set(e.code_salarie, e.description_equipe || "");
  });

  const absenteeismItems: AbsenteeismItem[] = selectedMonthAbsences
    .filter((a) => nonTempCodes.has(a.code_salarie) && Number(a.pct_absenteisme || 0) > 0)
    .map((a) => {
      const etp = empEtpMap.get(a.code_salarie) ?? 1;
      return {
        code_salarie: a.code_salarie,
        vehicle_type: empVehicleMap.get(a.code_salarie) ?? "?",
        description_equipe: empEquipeMap.get(a.code_salarie) ?? "",
        pct_absenteisme: Number(a.pct_absenteisme || 0),
        hrs_maladie: Number(a.hrs_maladie || 0),
        hrs_accident: Number(a.hrs_accident || 0),
        hrs_maternite: Number(a.hrs_maternite || 0),
        hrs_raisons_familiales: Number(a.hrs_raisons_familiales || 0),
        hrs_conge_accompagnement: Number(a.hrs_conge_accompagnement || 0),
        hrs_accueil: Number(a.hrs_accueil || 0),
        heures_theoriques: Number(a.heures_theoriques || 0),
        etp_perdu: Math.round((Number(a.pct_absenteisme || 0) / 100) * etp * 100) / 100,
      };
    })
    .sort((a, b) => b.etp_perdu - a.etp_perdu);

  const absenteeismEtpTotal = Math.round(absenteeismItems.reduce((sum, d) => sum + d.etp_perdu, 0) * 10) / 10;

  // ============================================================
  // Détail MCT pour le mois sélectionné
  // ============================================================

  const selectedMonthMct = allAbsencesMct.filter((a) => Number(a.mois) === selectedMonth);
  const workableHrsSelected = getWorkableHoursInMonth(selectedYear, selectedMonth);

  // Aggregate MCT rows per employee (multiple absence days per employee)
  const mctByEmployee = new Map<string, { nom: string; equipe: string; prestation: string; totalHrs: number; nbJours: number }>();
  for (const row of selectedMonthMct) {
    const code = row.code_salarie;
    const existing = mctByEmployee.get(code);
    if (existing) {
      existing.totalHrs += Number(row.duree_hrs || 0);
      existing.nbJours += 1;
    } else {
      mctByEmployee.set(code, {
        nom: row.nom_salarie || "",
        equipe: row.equipe || "",
        prestation: row.prestation || "",
        totalHrs: Number(row.duree_hrs || 0),
        nbJours: 1,
      });
    }
  }

  const mctItems: MctItem[] = [...mctByEmployee.entries()]
    .map(([code, data]) => ({
      code_salarie: code,
      nom_salarie: data.nom,
      vehicle_type: empVehicleMap.get(code) ?? "?",
      description_equipe: data.equipe || empEquipeMap.get(code) || "",
      prestation: data.prestation,
      total_hrs: Math.round(data.totalHrs * 10) / 10,
      nb_jours: data.nbJours,
      etp_perdu: workableHrsSelected > 0 ? Math.round((data.totalHrs / workableHrsSelected) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.total_hrs - a.total_hrs);

  const mctTotalHrs = Math.round(mctItems.reduce((sum, d) => sum + d.total_hrs, 0) * 10) / 10;
  const mctEtpTotal = Math.round(mctItems.reduce((sum, d) => sum + d.etp_perdu, 0) * 10) / 10;

  // ============================================================
  // Détail absences injustifiées pour le mois sélectionné
  // ============================================================

  const selectedMonthInjustifiees = allAbsencesInjustifiees.filter((a) => Number(a.mois) === selectedMonth);

  // Aggregate per employee
  const injByEmployee = new Map<string, { nom: string; totalHrs: number; nbJours: number }>();
  for (const row of selectedMonthInjustifiees) {
    const code = row.code_salarie;
    const hrs = Number(row.duree_hrs || 0);
    const existing = injByEmployee.get(code);
    if (existing) {
      existing.totalHrs += hrs;
      existing.nbJours += 1;
    } else {
      injByEmployee.set(code, {
        nom: row.nom_salarie || "",
        totalHrs: hrs,
        nbJours: 1,
      });
    }
  }

  const injustifieesItems: InjustifieeItem[] = [...injByEmployee.entries()]
    .map(([code, data]) => ({
      code_salarie: code,
      nom_salarie: data.nom,
      vehicle_type: empVehicleMap.get(code) ?? "?",
      description_equipe: empEquipeMap.get(code) || "",
      total_hrs: Math.round(data.totalHrs * 10) / 10,
      nb_jours: data.nbJours,
      etp_perdu: workableHrsSelected > 0
        ? Math.round((data.totalHrs / (workableHrsSelected * (empEtpMap.get(code) ?? 1))) * (empEtpMap.get(code) ?? 1) * 100) / 100
        : 0,
    }))
    .sort((a, b) => b.total_hrs - a.total_hrs);

  const injTotalHrs = Math.round(injustifieesItems.reduce((sum, d) => sum + d.total_hrs, 0) * 10) / 10;
  const injEtpTotal = Math.round(injustifieesItems.reduce((sum, d) => sum + d.etp_perdu, 0) * 10) / 10;

  // Taux d'absentéisme pour le mois sélectionné = (net - réel) / net
  // Calculé après la boucle headcount, initialisé ici
  let avgAbsenteeism = 0;

  // Départs prévisibles: employees with date_sortie after refDate but within the selected year
  const yearEnd = `${selectedYear}-12-31`;
  const departsPrevus = allEmployees.filter(
    (e) => e.date_sortie && e.date_sortie > refDate && e.date_sortie <= yearEnd
  );

  // Gap vs cible
  const targetTotal = allTargets.reduce((sum, t) => sum + Number(t.target_headcount), 0);
  const gapVsCible = targetTotal > 0 ? Math.round((effectifNetEtp - targetTotal) * 10) / 10 : null;

  // stats construit après la boucle headcount (besoin de avgAbsenteeism)

  // ============================================================
  // Headcount evolution (month by month for selected year)
  // ============================================================

  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const headcountData: HeadcountDataPoint[] = [];
  let lastKnownCnsRate: number | null = null;
  let lastKnownMctRate: number | null = null;

  for (let m = 1; m <= 12; m++) {
    const monthEnd = lastDayOfMonth(selectedYear, m);
    const isProjection = selectedYear > currentYear || (selectedYear === currentYear && m > currentMonth);

    const activeAtMonth = getActiveEmployeesAt(monthEnd);

    const brutEtpAtMonth = activeAtMonth.reduce((sum, e) => sum + getEtp(e), 0);
    const tempExitsEtp = activeAtMonth.filter((e) => e.est_sortie_temporaire).reduce((sum, e) => sum + getEtp(e), 0);
    const netEtpAtMonth = brutEtpAtMonth - tempExitsEtp;

    // Effectif réel après maladie
    // Grâce à la reclassification, les employés maladie CNS ne sont plus
    // comptés comme sorties temporaires → ils font partie de l'effectif net
    // On calcule leur impact maladie individuellement (pct_absenteisme * taux_occupation)
    let absentEtp: number;

    const monthAbs = allAbsences.filter((a) => Number(a.mois) === m);
    const hasAbsenceData = monthAbs.length > 0;

    let effectifReel: number;
    if (hasAbsenceData) {
      const nonTempSet = new Set(
        activeAtMonth.filter((e) => !e.est_sortie_temporaire).map((e) => e.code_salarie)
      );
      const empTauxMap = new Map<string, number>();
      activeAtMonth.forEach((e) => empTauxMap.set(e.code_salarie, getEtp(e)));

      absentEtp = monthAbs.reduce((sum, a) => {
        if (!nonTempSet.has(a.code_salarie)) return sum;
        const etp = empTauxMap.get(a.code_salarie) ?? 0;
        return sum + (Number(a.pct_absenteisme || 0) / 100) * etp;
      }, 0);
      effectifReel = netEtpAtMonth - absentEtp;
      // Mémoriser le dernier taux CNS connu
      if (netEtpAtMonth > 0) {
        lastKnownCnsRate = (absentEtp / netEtpAtMonth) * 100;
      }
    } else {
      // Pas de données réelles CNS → appliquer le dernier taux CNS connu
      const cnsRate = lastKnownCnsRate ?? 0;
      absentEtp = netEtpAtMonth * (cnsRate / 100);
      effectifReel = netEtpAtMonth - absentEtp;
    }

    // Capturer le taux d'absentéisme pour le mois sélectionné
    if (m === selectedMonth && netEtpAtMonth > 0) {
      avgAbsenteeism = (absentEtp / netEtpAtMonth) * 100;
    }

    // Effectif après MCT = effectif réel - FTE perdus par maladies court terme non CNS
    const monthMct = allAbsencesMct.filter((a) => Number(a.mois) === m);
    let effectifApresMct: number | undefined;
    let projectedApresMct: number | undefined;
    if (monthMct.length > 0) {
      const totalMctHrs = monthMct.reduce((sum, a) => sum + Number(a.duree_hrs || 0), 0);
      const workableHrs = getWorkableHoursInMonth(selectedYear, m);
      const ftePerdus = workableHrs > 0 ? totalMctHrs / workableHrs : 0;
      effectifApresMct = Math.max(0, Math.round((effectifReel - ftePerdus) * 10) / 10);
      // Mémoriser le dernier taux MCT connu
      if (effectifReel > 0) {
        lastKnownMctRate = (ftePerdus / effectifReel) * 100;
      }
    } else if (lastKnownMctRate !== null) {
      // Projeter avec le dernier taux MCT connu (affiché en pointillé)
      const ftePerdus = effectifReel * (lastKnownMctRate / 100);
      projectedApresMct = Math.max(0, Math.round((effectifReel - ftePerdus) * 10) / 10);
    }

    // Effectif après absences injustifiées = effectif après MCT - FTE perdus par absences injustifiées
    const monthInj = allAbsencesInjustifiees.filter((a) => Number(a.mois) === m);
    let effectifApresInjustifiees: number | undefined;
    if (monthInj.length > 0) {
      const totalInjHrs = monthInj.reduce((sum, a) => sum + Number(a.duree_hrs || 0), 0);
      const workableHrs = getWorkableHoursInMonth(selectedYear, m);
      const ftePerdusInj = workableHrs > 0 ? totalInjHrs / workableHrs : 0;
      const base = effectifApresMct ?? effectifReel;
      effectifApresInjustifiees = Math.max(0, Math.round((base - ftePerdusInj) * 10) / 10);
    }

    headcountData.push({
      month: FRENCH_MONTHS_SHORT[m],
      effectif_brut: Math.round(brutEtpAtMonth * 10) / 10,
      effectif_net: Math.max(0, Math.round(netEtpAtMonth * 10) / 10),
      effectif_reel: Math.max(0, Math.round(effectifReel * 10) / 10),
      effectif_apres_mct: effectifApresMct,
      projected_apres_mct: projectedApresMct,
      effectif_apres_injustifiees: effectifApresInjustifiees,
      is_projection: isProjection,
      target: targetTotal > 0 ? targetTotal : undefined,
    });
  }

  // Jonction pour la projection MCT : ajouter le point projeté sur le dernier mois avec données réelles
  const lastMctRealIdx = headcountData.reduce((last, d, i) => d.effectif_apres_mct != null ? i : last, -1);
  if (lastMctRealIdx >= 0 && headcountData.some((d) => d.projected_apres_mct != null)) {
    headcountData[lastMctRealIdx].projected_apres_mct = headcountData[lastMctRealIdx].effectif_apres_mct;
  }

  // ============================================================
  // Scenario projections for chart overlay
  // ============================================================

  const scenarioOptions: ScenarioOption[] = allScenariosRaw.map((s) => ({
    id: s.id,
    name: s.name,
  }));

  // Fetch all scenario data in parallel
  const scenarioProjections: ScenarioProjectionData[] = [];

  if (scenarioOptions.length > 0) {
    const scenarioIds = scenarioOptions.map((s) => s.id);

    const [scenarioParamsAll, scenarioDeparturesAll, scenarioArrivalsAll, scenarioDetailsAll] = await Promise.all([
      fetchAll(supabase.from("wp_scenario_monthly_params").select("*").in("scenario_id", scenarioIds)),
      fetchAll(supabase.from("wp_scenario_departures").select("*").in("scenario_id", scenarioIds)),
      fetchAll(supabase.from("wp_scenario_arrival_hypotheses").select("*").in("scenario_id", scenarioIds)),
      fetchAll(supabase.from("wp_scenarios").select("id, projected_turnover_rate").in("id", scenarioIds)),
    ]);

    for (const sc of scenarioOptions) {
      const scParams = scenarioParamsAll.filter((p) => p.scenario_id === sc.id);
      const scDepartures = scenarioDeparturesAll.filter((d) => d.scenario_id === sc.id);
      const scArrivals = scenarioArrivalsAll.filter((a) => a.scenario_id === sc.id) as unknown as ArrivalHypothesis[];
      const scDetail = scenarioDetailsAll.find((s) => s.id === sc.id);
      const turnoverRate = Number(scDetail?.projected_turnover_rate ?? 0);

      // Use global rates (centre_cout IS NULL) for scenario overlay
      const absRateByMonth = new Map<number, number>();
      scParams
        .filter((p) => !p.centre_cout)
        .forEach((p) => absRateByMonth.set(Number(p.mois), Number(p.projected_absenteeism_rate)));

      // Build departure counts by month
      const depCountByMonth = new Map<number, number>();
      scDepartures
        .filter((d) => Number(d.departure_year) === selectedYear)
        .forEach((d) => {
          const m = Number(d.departure_month);
          depCountByMonth.set(m, (depCountByMonth.get(m) || 0) + 1);
        });

      // Return counts from temp exits
      const returnCountByMonth = new Map<number, number>();
      scDepartures
        .filter((d) => Number(d.return_year) === selectedYear && d.return_month)
        .forEach((d) => {
          const m = Number(d.return_month);
          returnCountByMonth.set(m, (returnCountByMonth.get(m) || 0) + 1);
        });

      // Find the last real month's values as starting point
      const lastRealIdx = headcountData.findIndex((d) => d.is_projection) - 1;
      const lastReal = lastRealIdx >= 0 ? headcountData[lastRealIdx] : headcountData[headcountData.length - 1];

      let runningBrut = lastReal.effectif_brut;
      let runningTempExitsEtp = lastReal.effectif_brut - lastReal.effectif_net;

      const months: ScenarioProjectionData["months"] = [];

      for (let m = 1; m <= 12; m++) {
        const isProjection = selectedYear > currentYear || (selectedYear === currentYear && m > currentMonth);
        if (!isProjection) continue;

        // Turnover losses
        const monthlyTurnoverRate = turnoverRate / 100 / 12;
        const turnoverLosses = Math.round(runningBrut * monthlyTurnoverRate * 10) / 10;

        // Known departures
        const knownDeps = depCountByMonth.get(m) || 0;

        // Data-based departures (employees with date_sortie in this month)
        const dataExits = allEmployees.filter((e) => {
          if (!e.date_sortie) return false;
          const d = new Date(e.date_sortie);
          return d.getMonth() + 1 === m && d.getFullYear() === selectedYear;
        }).length;

        // Arrivals from hypotheses
        const arrivals = getArrivalsForMonth(scArrivals, m, selectedYear);
        // CDD auto-departures
        const cddDepartures = getCddDeparturesForMonth(scArrivals, m, selectedYear);

        // Returns from temp exits
        const returns = returnCountByMonth.get(m) || 0;

        const totalDepartures = Math.max(knownDeps, dataExits) + turnoverLosses + cddDepartures;

        runningBrut = Math.max(0, runningBrut - totalDepartures + arrivals + returns);
        runningTempExitsEtp = Math.max(0, runningTempExitsEtp - returns);

        const scenarioNet = runningBrut - runningTempExitsEtp;

        // Réel projeté = net - dernier taux CNS connu
        const cnsRate = lastKnownCnsRate ?? 0;
        const scenarioCnsEtp = scenarioNet * (cnsRate / 100);
        const scenarioReel = scenarioNet - scenarioCnsEtp;

        // Le taux d'absentéisme du scénario impacte le MCT
        const absRate = absRateByMonth.get(m) ?? 5;
        const scenarioMctFte = scenarioNet * (absRate / 100);

        months.push({
          month_index: m,
          scenario_brut: Math.round(runningBrut * 10) / 10,
          scenario_net: Math.max(0, Math.round(scenarioNet * 10) / 10),
          scenario_reel: Math.max(0, Math.round(scenarioReel * 10) / 10),
          scenario_apres_mct: Math.max(0, Math.round((scenarioReel - scenarioMctFte) * 10) / 10),
        });
      }

      scenarioProjections.push({ scenario_id: sc.id, months });
    }
  }

  // ============================================================
  // Taux MCT = total heures MCT / total heures travaillables ajustées au taux d'occupation
  // ============================================================

  const workableHrsSelectedMonth = getWorkableHoursInMonth(selectedYear, selectedMonth);
  // Base ajustée = heures travaillables * taux_occupation pour chaque employé actif non temp
  const totalAdjustedWorkableHrs = nonTempActiveAtRef.reduce(
    (sum, e) => sum + workableHrsSelectedMonth * getEtp(e), 0
  );
  const totalMctHrsSelected = selectedMonthMct.reduce(
    (sum, a) => sum + Number(a.duree_hrs || 0), 0
  );
  // Taux MCT = uniquement basé sur les données réelles (pas de projection scénario ici)
  const tauxMct = (selectedMonthMct.length > 0 && totalAdjustedWorkableHrs > 0)
    ? (totalMctHrsSelected / totalAdjustedWorkableHrs) * 100
    : 0;

  // Taux absences injustifiées = total heures injustifiées / total heures travaillables ajustées
  const totalInjHrsSelected = selectedMonthInjustifiees.reduce(
    (sum, a) => sum + Number(a.duree_hrs || 0), 0
  );
  const tauxInjustifiees = totalAdjustedWorkableHrs > 0
    ? (totalInjHrsSelected / totalAdjustedWorkableHrs) * 100
    : 0;
  console.log("[DEBUG] injustifiees:", { allCount: allAbsencesInjustifiees.length, selectedMonthCount: selectedMonthInjustifiees.length, totalInjHrsSelected, totalAdjustedWorkableHrs, tauxInjustifiees, selectedMonth });

  const stats: WpDashboardStats = {
    effectif_brut: Math.round(effectifBrutEtp * 10) / 10,
    effectif_net: Math.round(effectifNetEtp * 10) / 10,
    bus_count: Math.round(busEtp * 10) / 10,
    cam_count: Math.round(camEtp * 10) / 10,
    headcount,
    taux_absenteisme: avgAbsenteeism,
    taux_mct: tauxMct,
    taux_injustifiees: tauxInjustifiees,
    etp_total: Math.round(effectifBrutEtp * 10) / 10,
    departs_prevus: departsPrevus.length,
    sorties_temporaires: Math.round(sortiesTempEtp * 10) / 10,
    gap_vs_cible: gapVsCible,
    target_total: targetTotal > 0 ? targetTotal : null,
  };

  // ============================================================
  // Departures list
  // ============================================================

  const departureItems: DepartureItem[] = departsPrevus
    .sort((a, b) => (a.date_sortie || "").localeCompare(b.date_sortie || ""))
    .map((e) => ({
      code_salarie: e.code_salarie,
      vehicle_type: e.vehicle_type || "?",
      description_equipe: e.description_equipe || "",
      date_sortie: e.date_sortie!,
      motif: e.description_motif_sortie || "Non spécifié",
      type: e.est_sortie_temporaire ? "temporaire" as const : "definitive" as const,
    }));

  // ============================================================
  // Arrivals list
  // ============================================================

  // Nouveaux engagés: date_entree after refDate but within the year
  const nouveauxEngages = allEmployees.filter(
    (e) => e.date_entree && e.date_entree > refDate && e.date_entree <= yearEnd
  );

  // Retours de suspension: est_sortie_temporaire with date_fin_sortie_temporaire after refDate
  const retoursSuspension = allEmployees.filter(
    (e) =>
      e.est_sortie_temporaire &&
      e.date_fin_sortie_temporaire &&
      e.date_fin_sortie_temporaire >= refDate &&
      e.date_fin_sortie_temporaire <= yearEnd
  );

  const arrivalItems: ArrivalItem[] = [
    ...nouveauxEngages
      .sort((a, b) => (a.date_entree || "").localeCompare(b.date_entree || ""))
      .map((e) => ({
        code_salarie: e.code_salarie,
        vehicle_type: e.vehicle_type || "?",
        description_equipe: e.description_equipe || "",
        date: e.date_entree!,
        motif: "",
        type: "nouveau" as const,
      })),
    ...retoursSuspension
      .sort((a, b) =>
        (a.date_fin_sortie_temporaire || "").localeCompare(b.date_fin_sortie_temporaire || "")
      )
      .map((e) => ({
        code_salarie: e.code_salarie,
        vehicle_type: e.vehicle_type || "?",
        description_equipe: e.description_equipe || "",
        date: e.date_fin_sortie_temporaire!,
        motif: e.description_motif_sortie || "Non spécifié",
        type: "retour" as const,
      })),
  ];

  // ============================================================
  // Breakdown by type and depot (at selected month)
  // ============================================================

  const byType: BreakdownByType[] = [
    {
      label: "BUS",
      actifs: activeEmployees.filter((e) => e.vehicle_type === "BUS" && !e.est_sortie_temporaire).length,
      sorties_temp: activeEmployees.filter((e) => e.vehicle_type === "BUS" && e.est_sortie_temporaire).length,
      departs: departsPrevus.filter((e) => e.vehicle_type === "BUS").length,
    },
    {
      label: "CAM",
      actifs: activeEmployees.filter((e) => e.vehicle_type === "CAM" && !e.est_sortie_temporaire).length,
      sorties_temp: activeEmployees.filter((e) => e.vehicle_type === "CAM" && e.est_sortie_temporaire).length,
      departs: departsPrevus.filter((e) => e.vehicle_type === "CAM").length,
    },
  ];

  // By depot
  const depotMap = new Map<string, { bus: number; cam: number }>();
  activeEmployees.forEach((e) => {
    const depot = e.description_departement || e.description_service || "Non assigné";
    if (!depot) return;
    const existing = depotMap.get(depot) || { bus: 0, cam: 0 };
    if (e.vehicle_type === "BUS") existing.bus++;
    else if (e.vehicle_type === "CAM") existing.cam++;
    depotMap.set(depot, existing);
  });

  const byDepot: BreakdownByDepot[] = [...depotMap.entries()]
    .map(([depot, counts]) => ({
      depot: depot.replace("Depots - ", ""),
      bus: counts.bus,
      cam: counts.cam,
      total: counts.bus + counts.cam,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  // ============================================================
  // Gap analysis data
  // ============================================================

  const gapData: GapDataPoint[] = headcountData.map((hd) => ({
    month: hd.month,
    effectif_net: hd.effectif_net,
    target: targetTotal,
    gap: hd.effectif_net - targetTotal,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Workforce Planning</h1>
        <p className="text-muted-foreground">
          Prévision et suivi des effectifs — {MONTH_LABELS[selectedMonth]} {selectedYear}
          {selectedFonctions.length > 0 && ` — ${selectedFonctions.length} fonction(s)`}
          {selectedCC.length > 0 && ` — ${selectedCC.length} cost center(s)`}
          {selectedDepots.length > 0 && ` — ${selectedDepots.length} dépôt(s)`}
        </p>
      </div>

      <WpKpiCards stats={stats} />

      <HeadcountEvolutionChart
        data={headcountData}
        scenarios={scenarioOptions}
        scenarioProjections={scenarioProjections}
      />

      {targetTotal > 0 && <GapAnalysisChart data={gapData} />}

      <TempExitsTable items={tempExitItems} />

      <AbsenteeismTable
        items={absenteeismItems}
        tauxGlobal={avgAbsenteeism}
        etpPerdusTotal={absenteeismEtpTotal}
      />

      <MctTable
        items={mctItems}
        totalHrs={mctTotalHrs}
        etpPerdusTotal={mctEtpTotal}
      />

      <InjustifieesTable
        items={injustifieesItems}
        totalHrs={injTotalHrs}
        etpPerdusTotal={injEtpTotal}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <DepartureTable departures={departureItems} />
        <ArrivalTable arrivals={arrivalItems} />
      </div>

      <BreakdownChart byType={byType} byDepot={byDepot} />
    </div>
  );
}
