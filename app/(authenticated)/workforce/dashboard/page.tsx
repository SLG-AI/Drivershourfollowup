import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { listRosterPeriods, rangPeriode, resolveRosterPeriod } from "@/lib/utils/roster-period";
import { ajouterPhotoSiAbsente, indexerPhotos, photoPourLeMois } from "@/lib/utils/roster-photos";
import { AUCUNE_VALEUR, lireFiltresWorkforce } from "@/lib/utils/wp-filtres";
import { computeRosterMovements, reclassifierSortiesTemporaires, sortiesConstateesSur as sortiesConstateesSurListes, type MovementItem } from "@/lib/utils/wp-movements";
import { MovementsPanel } from "@/components/workforce/movements-panel";
import { computeEffectifMoyen } from "@/lib/utils/wp-effectif-moyen";
import { construireCourbeEffectifs, type MoisAnnee } from "@/lib/utils/wp-courbe-effectifs";
import { etpDe, etpDisponibleDe, etpSuspenduDe, injustifieesDuPerimetre, type SalariePaliers } from "@/lib/utils/wp-paliers";
import { estCongeParentalTempsPartielParTaux, estFinDeMission, estSortieHorsTurnover, LABEL_PARENTAL_TEMPS_PARTIEL } from "@/lib/utils/wp-suspension";
import { WpKpiCards, type WpDashboardStats } from "@/components/workforce/kpi-cards";
import { HeadcountEvolutionChart, type HeadcountDataPoint, type ScenarioOption } from "@/components/workforce/headcount-evolution-chart";
import { getWorkableHoursInMonth, horsWeekEnd, joursOuvresEntre, jourSuivant, lastDayOfMonth, isTempExitAt, moisEffetSortie } from "@/lib/utils/wp-calculations";
import { projeterScenarios } from "@/lib/utils/wp-projection-scenarios";
import { DepartureTable, type DepartureItem } from "@/components/workforce/departure-table";
import { ArrivalTable, type ArrivalItem } from "@/components/workforce/arrival-table";
import { TempExitsTable, type TempExitItem } from "@/components/workforce/temp-exits-table";
import { HeadcountTable, type HeadcountItem } from "@/components/workforce/headcount-table";
import { GapAnalysisChart, type GapDataPoint } from "@/components/workforce/gap-analysis-chart";
import { AbsenteeismTable, type AbsenteeismItem } from "@/components/workforce/absenteeism-table";
import { MctTable, type MctItem } from "@/components/workforce/mct-table";
import { InjustifieesTable, type InjustifieeItem } from "@/components/workforce/injustifiees-table";
import { FRENCH_MONTHS_SHORT } from "@/lib/constants";
import { ScenarioHypothesesCard } from "@/components/workforce/scenario-hypotheses-card";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";
import { plafonnerTauxCns } from "@/lib/utils/wp-taux-cns";

const MONTH_LABELS: Record<number, string> = {
  1: "Janvier", 2: "Février", 3: "Mars", 4: "Avril",
  5: "Mai", 6: "Juin", 7: "Juillet", 8: "Août",
  9: "Septembre", 10: "Octobre", 11: "Novembre", 12: "Décembre",
};


interface Props {
  searchParams: Promise<{ year?: string; month?: string; societes?: string; fonctions?: string; cc?: string; depots?: string; equipes?: string; contrats?: string; employee?: string; scenarios?: string; turnover_src?: string; abs_src?: string; leave_src?: string }>;
}

export default async function WorkforceDashboardPage({ searchParams }: Props) {
  const params = await searchParams;
  const supabase = await createClient();
  const now = new Date();
  const selectedYear = params.year ? parseInt(params.year) : now.getFullYear();
  const selectedMonth = params.month ? parseInt(params.month) : now.getMonth() + 1;
  const filtres = lireFiltresWorkforce(params);
  const selectedFonctions = filtres.fonctions;
  const selectedCC = filtres.cc;
  const selectedDepots = filtres.depots;
  const selectedEquipes = filtres.equipes;
  const selectedContrats = filtres.contrats;
  const selectedEmployee = filtres.employee;
  const selectedScenarioIds = params.scenarios ? params.scenarios.split(",").filter(Boolean) : [];
  const turnoverSrcId = params.turnover_src || null;
  const absSrcId = params.abs_src || null;
  const leaveSrcId = params.leave_src || null;

  // Lien vers la page Méthodologie, filtres courants conservés : chaque carte
  // KPI y renvoie sur la définition de son propre indicateur, même périmètre.
  const qsMethodologie = new URLSearchParams();
  (["year", "month", "societes", "fonctions", "cc", "depots", "equipes", "contrats", "employee"] as const).forEach((k) => {
    const v = params[k];
    if (v) qsMethodologie.set(k, v);
  });
  const lienMethodologie = `/workforce/methodologie${qsMethodologie.size ? `?${qsMethodologie}` : ""}`;

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

  // Roster historisé : on ne lit QUE la photographie du mois affiché, sinon
  // chaque salarié serait compté une fois par mois présent en base.
  const { periode: rosterPeriode, exacte: rosterPeriodeExacte } =
    await resolveRosterPeriod(supabase, selectedMonth, selectedYear);

  // Mouvements du mois : comparaison avec la photographie du mois PRÉCÉDENT.
  // Elle n'a de sens que si les deux photographies existent réellement : avec
  // un repli sur un roster antérieur, on comparerait deux fois la même photo.
  const moisPrecedent = selectedMonth === 1
    ? { mois: 12, annee: selectedYear - 1 }
    : { mois: selectedMonth - 1, annee: selectedYear };
  const periodesRoster = await listRosterPeriods(supabase);
  const moisPrecedentDisponible =
    rosterPeriodeExacte &&
    periodesRoster.some((p) => p.mois === moisPrecedent.mois && p.annee === moisPrecedent.annee);

  // Fetch all data in parallel (paginated to avoid 1000-row limit)
  // Année future : les taux d'absence repartent des derniers mois connus de
  // l'année précédente (chargée seulement dans ce cas).
  const anneeFuture = selectedYear > now.getFullYear();
  const [employees, employeesMoisPrecedent, absences, salaryStats, absencesMct, absencesInjustifiees, targets, defaultScenarios, allScenariosRaw, mouvementsSirh, photosAnnee, absencesAnneePrec, mctAnneePrec, injAnneePrec] = await Promise.all([
    fetchAll(
      supabase
        .from("wp_employees")
        .select("*")
        .eq("mois", rosterPeriode?.mois ?? -1)
        .eq("annee", rosterPeriode?.annee ?? -1)
    ),
    moisPrecedentDisponible
      ? fetchAll(
          supabase
            .from("wp_employees")
            .select("*")
            .eq("mois", moisPrecedent.mois)
            .eq("annee", moisPrecedent.annee)
        )
      : Promise.resolve([] as Record<string, unknown>[]),
    fetchAll(supabase.from("wp_absences").select("*").eq("annee", selectedYear)).then(plafonnerTauxCns),
    fetchAll(supabase.from("wp_salary_stats").select("*").eq("annee", selectedYear)),
    fetchAll(supabase.from("wp_absences_mct").select("*").eq("annee", selectedYear)),
    fetchAll(supabase.from("wp_absences_injustifiees").select("*").eq("annee", selectedYear)),
    fetchAll(supabase.from("wp_target_needs").select("*")),
    fetchAll(supabase.from("wp_scenarios").select("id, is_default").order("is_default", { ascending: false }).order("updated_at", { ascending: false })),
    fetchAll(supabase.from("wp_scenarios").select("id, name").order("created_at", { ascending: false })),
    // Sorties constatées par le SIRH (export IN/OUT) sur le mois affiché et le précédent
    fetchAll(
      supabase
        .from("wp_mouvements")
        .select("code_salarie, type, date_sortie, motif_sortie, mois, annee")
        .in("annee", Array.from(new Set([selectedYear, moisPrecedent.annee])))
        .in("type", ["sortie", "sortie_temporaire"])
    ),
    // Toutes les photographies de l'année, colonnes de la courbe seulement :
    // chaque mois de l'évolution des effectifs se lit dans SA photo (voir plus bas).
    fetchAll(
      supabase
        .from("wp_employees")
        .select("code_salarie, code_employeur, mois, annee, date_entree, date_sortie, date_debut_sortie_temporaire, date_fin_sortie_temporaire, taux_occupation, est_sortie_temporaire, description_motif_sortie, description_fonction, centre_cout, description_service, description_equipe, type_contrat, nom_salarie, vehicle_type")
        .eq("annee", selectedYear)
    ),
    anneeFuture ? fetchAll(supabase.from("wp_absences").select("code_salarie, mois, pct_absenteisme, hrs_maladie").eq("annee", selectedYear - 1)).then(plafonnerTauxCns) : Promise.resolve([] as Record<string, unknown>[]),
    anneeFuture ? fetchAll(supabase.from("wp_absences_mct").select("code_salarie, mois, date_absence, duree_hrs").eq("annee", selectedYear - 1)) : Promise.resolve([] as Record<string, unknown>[]),
    anneeFuture ? fetchAll(supabase.from("wp_absences_injustifiees").select("code_salarie, mois, duree_hrs").eq("annee", selectedYear - 1)) : Promise.resolve([] as Record<string, unknown>[]),
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

  // Apply fonction, cost center, depot and employee filters
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const passeLesFiltres = (e: any) => filtres.passe(e);
  const allEmployees = employees.filter(passeLesFiltres);
  // Même filtre sur la photo précédente, sinon un salarié hors périmètre
  // passerait pour un nouvel engagé ou un sorti.
  const employeesPrecedents = employeesMoisPrecedent.filter(passeLesFiltres);

  // Filter absences/salary stats to matching employees
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const employeeCodes = new Set(allEmployees.map((e: any) => e.code_salarie));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allAbsences = absences.filter((a: any) => employeeCodes.has(a.code_salarie));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allSalaryStats = salaryStats.filter((s: any) => employeeCodes.has(s.code_salarie));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // Week-ends écartés : le dénominateur (heures travaillables) ne compte que lundi-vendredi.
  const mctHorsWeekEnd = horsWeekEnd(absencesMct);
  const allAbsencesMct = mctHorsWeekEnd.filter((a: any) => employeeCodes.size === 0 || employeeCodes.has(a.code_salarie));
  // Injustifiées : tout le fichier sans filtre (y compris un salarié absent du
  // roster), restreintes au périmètre dès qu'un filtre est actif.
  const allAbsencesInjustifiees = injustifieesDuPerimetre(absencesInjustifiees, filtres.actifs, employeeCodes);
  const allTargets = targets;

  // ============================================================
  // Reclassification : les employés flaggés "sortie temporaire"
  // qui apparaissent dans le fichier CNS avec des heures maladie
  // et dont le motif n'est PAS un congé structurel sont reclassifiés
  // comme absents maladie (est_sortie_temporaire = false)
  // ============================================================

  // Codes des employés avec heures maladie dans le CNS (tous mois confondus pour
  // l'année). Une année future n'a aucune absence : sans les codes de l'année
  // précédente, la reclassification ne s'appliquerait pas et l'effectif de départ
  // différerait de celui de la dernière année connue.
  const codesMaladieAnneePrec = anneeFuture
    ? absencesAnneePrec.filter((a) => Number(a.hrs_maladie || 0) > 0).map((a) => String(a.code_salarie))
    : [];
  const codesAvecMaladieCns = new Set([
    ...allAbsences.filter((a) => Number(a.hrs_maladie || 0) > 0).map((a) => a.code_salarie),
    ...codesMaladieAnneePrec,
  ]);

  // Reclassifier dans allEmployees, et à l'identique dans la photo précédente
  // (logique partagée dans wp-movements.ts)
  reclassifierSortiesTemporaires(allEmployees, codesAvecMaladieCns);
  reclassifierSortiesTemporaires(employeesPrecedents, codesAvecMaladieCns);

  // ============================================================
  // Photographies par mois pour la courbe d'évolution.
  // Un export SIRH ne contient que les présents à sa date : reconstruire les
  // 12 mois depuis la seule photo affichée ignore les embauches postérieures
  // (courbe qui ne peut que descendre) et les départs antérieurs (courbe qui
  // ne peut que monter), d'où un pic systématique sur le mois choisi. Chaque
  // mois se lit donc dans sa propre photo ; un mois sans photo reconduit la
  // plus récente antérieure, y compris pour les mois à venir.
  // ============================================================
  const photosParRang = indexerPhotos(photosAnnee);
  // La photo affichée peut venir d'une année antérieure (repli) : on l'ajoute
  // pour qu'un début d'année sans photo se reconduise depuis elle.
  ajouterPhotoSiAbsente(photosParRang, rosterPeriode, employees);
  // Même filtre et même reclassification que la photo affichée. Les codes
  // maladie viennent de toute l'année : un salarié absent de la photo affichée
  // peut l'être d'une autre.
  const codesAvecMaladieCnsAnnee = new Set([
    ...absences.filter((a) => Number(a.hrs_maladie || 0) > 0).map((a) => a.code_salarie),
    ...codesMaladieAnneePrec,
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const photosPreparees = new Map<number, any[]>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const photoDuMoisDe = (m: number, annee: number): any[] => {
    const { lignes, periode } = photoPourLeMois(photosParRang, m, annee);
    if (!periode) return allEmployees;
    const r = rangPeriode(periode);
    let prete = photosPreparees.get(r);
    if (!prete) {
      prete = reclassifierSortiesTemporaires(lignes.filter(passeLesFiltres), codesAvecMaladieCnsAnnee);
      photosPreparees.set(r, prete);
    }
    return prete;
  };
  const photoDuMois = (m: number) => photoDuMoisDe(m, selectedYear);

  // Mouvements entre le mois précédent et le mois affiché. Les statistiques
  // salariales datent les sorties réelles (un CDD arrêté avant terme disparaît
  // du roster alors que la photo précédente ne connaît que la date prévue).
  // Source 1 : l'export IN/OUT du SIRH (date ET motif réels) ; source 2, à
  // défaut : la date de sortie des statistiques salariales.
  // Sorties constatées (IN/OUT, puis statistiques salariales) : voir wp-movements.ts
  const sortiesConstateesSur = (mois: number, annee: number, prec: MoisAnnee) =>
    sortiesConstateesSurListes(mouvementsSirh, salaryStats, mois, annee, prec);
  const sortiesConstatees = sortiesConstateesSur(selectedMonth, selectedYear, moisPrecedent);
  const mouvements = moisPrecedentDisponible
    ? computeRosterMovements(employeesPrecedents, allEmployees, selectedMonth, selectedYear, sortiesConstatees, {
        // Photos complètes : un muté vers un autre cost center n'est pas un disparu
        prev: employeesMoisPrecedent,
        curr: employees,
      })
    : null;

  // Transferts de périmètre POSTÉRIEURS au mois affiché : seule une photo de
  // roster plus récente peut les révéler. On compare chaque paire de photos
  // exactes consécutives après le mois affiché, comme le panneau Mouvements
  // le fait pour le mois lui-même. Sur la dernière photo de l'année : rien.
  const transfertsFuturs = (() => {
    const sortants: MovementItem[] = [];
    const entrants: MovementItem[] = [];
    for (let m = selectedMonth + 1; m <= 12; m++) {
      const photoM = photoPourLeMois(photosParRang, m, selectedYear);
      const precM: MoisAnnee = { mois: m - 1, annee: selectedYear };
      if (!photoM.exacte || !photoPourLeMois(photosParRang, precM.mois, precM.annee).exacte) continue;
      const mv = computeRosterMovements(
        photoDuMoisDe(precM.mois, precM.annee), photoDuMois(m), m, selectedYear,
        sortiesConstateesSur(m, selectedYear, precM),
        { prev: photoPourLeMois(photosParRang, precM.mois, precM.annee).lignes, curr: photoM.lignes }
      );
      const libelle = `${MONTH_LABELS[m]} ${selectedYear}`;
      mv.transfertsSortants.forEach((i) => sortants.push({ ...i, motif: `${libelle} — ${i.motif}` }));
      mv.transfertsEntrants.forEach((i) => entrants.push({ ...i, motif: `${libelle} — ${i.motif}` }));
    }
    return { sortants, entrants };
  })();

  // ============================================================
  // Helper: employees active at a given date
  // Active = date_entree <= date (or null = unknown start, count them)
  //          AND (date_sortie IS NULL OR date_sortie >= date)
  // ============================================================
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function actifsParmi(liste: any[], date: string) {
    return liste.filter((e) => {
      // If date_entree exists and is after the reference date, not yet hired
      if (e.date_entree && e.date_entree > date) return false;
      // If date_sortie exists and is before the reference date, already left
      // UNLESS the employee has an active temporary exit (e.g. maternity) that extends beyond
      if (e.date_sortie && e.date_sortie < date) {
        if (e.est_sortie_temporaire) {
          return true; // Temporary exit — keep in system (will return)
        }
        return false;
      }
      return true;
    });
  }
  function getActiveEmployeesAt(date: string) {
    return actifsParmi(allEmployees, date);
  }

  // ============================================================
  // Calculate KPIs for selected month
  // ============================================================

  const activeEmployees = getActiveEmployeesAt(refDate);
  const headcount = activeEmployees.length;

  // ETP, ETP suspendu et ETP disponible : définitions communes au tableau de
  // bord et à la page de méthodologie (lib/utils/wp-paliers.ts), pour que les
  // deux pages ne puissent pas donner deux chiffres différents.
  const getEtp = (e: Record<string, unknown>) => etpDe(e as unknown as SalariePaliers);
  const getEtpSuspendu = (e: Record<string, unknown>) => etpSuspenduDe(e as unknown as SalariePaliers);
  const getEtpDisponible = (e: Record<string, unknown>, date: string) =>
    etpDisponibleDe(e as unknown as SalariePaliers, date);

  // Effectif brut in ETP
  const effectifBrutEtp = activeEmployees.reduce((sum, e) => sum + getEtp(e), 0);
  const busEtp = activeEmployees.filter((e) => e.vehicle_type === "BUS").reduce((sum, e) => sum + getEtp(e), 0);
  const camEtp = activeEmployees.filter((e) => e.vehicle_type === "CAM").reduce((sum, e) => sum + getEtp(e), 0);

  // Sorties temporaires in ETP
  const sortiesTemp = activeEmployees.filter((e) => isTempExitAt(e, refDate));
  const sortiesTempEtp = sortiesTemp.reduce((sum, e) => sum + getEtpSuspendu(e), 0);
  const sortiesTemporairesCount = sortiesTemp.length;

  // Liste détaillée de l'effectif sous contrat (mêmes salariés que le KPI)
  const headcountItems: HeadcountItem[] = activeEmployees
    .slice()
    .sort((a, b) => (a.description_equipe || "").localeCompare(b.description_equipe || ""))
    .map((e) => ({
      code_salarie: e.code_salarie,
      nom_salarie: e.nom_salarie || null,
      vehicle_type: e.vehicle_type || "?",
      description_equipe: e.description_equipe || "",
      centre_cout: e.centre_cout || "",
      type_contrat: e.type_contrat || "",
      date_entree: e.date_entree || null,
      etp: Math.round(getEtp(e) * 100) / 100,
    }));

  // Liste détaillée des sorties temporaires actuelles
  // Deux populations dans cette liste :
  //  - congé EN COURS : le SIRH donne date_debut_sortie_temporaire et
  //    date_fin_sortie_temporaire ;
  //  - congé À VENIR : le salarié n'est pas encore flaggé « sortie temporaire »,
  //    seule sa date_sortie (= début prévu du congé) est connue, et le SIRH ne
  //    communique PAS de fin prévue. C'est reclassifierSortiesTemporaires qui
  //    les fait entrer ici (motif structurel + date de sortie).
  const tempExitItems: TempExitItem[] = sortiesTemp
    .map((e) => ({
      code_salarie: e.code_salarie,
      nom_salarie: e.nom_salarie || null,
      vehicle_type: e.vehicle_type || "?",
      description_equipe: e.description_equipe || "",
      date_debut: e.date_debut_sortie_temporaire || e.date_sortie || "",
      date_fin: e.date_fin_sortie_temporaire || null,
      // Congé pas encore commencé : début repris de la date de sortie, fin non communiquée
      a_venir: !e.date_debut_sortie_temporaire && !!e.date_sortie,
      // Congé parental à temps partiel encodé par le taux : motif vide dans
      // l'export, on le nomme pour le tableau (ETP retiré = 0, le taux suffit).
      motif: estCongeParentalTempsPartielParTaux(e)
        ? LABEL_PARENTAL_TEMPS_PARTIEL
        : e.description_motif_sortie || "Non spécifié",
      etp: Math.round(getEtpSuspendu(e) * 10) / 10,
      etp_salarie: Math.round(getEtp(e) * 10) / 10,
    }))
    // Les congés sans aucune date connue ferment la liste
    .sort((a, b) => (a.date_debut || "9999").localeCompare(b.date_debut || "9999"));

  // Effectif net in ETP = brut ETP - sorties temporaires ETP
  const effectifNetEtp = effectifBrutEtp - sortiesTempEtp;

  // ============================================================
  // Détail absentéisme pour le mois sélectionné
  // ============================================================

  const selectedMonthAbsences = allAbsences.filter((a) => Number(a.mois) === selectedMonth);
  // Salariés qui travaillent (au moins en partie) à la date de référence
  const nonTempActiveAtRef = activeEmployees.filter((e) => getEtpDisponible(e, refDate) > 0);
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
        pct_absenteisme_source: a.pct_absenteisme_source,
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

  // Aggregate per employee.
  // Une ligne du fichier des absences injustifiées décrit une PÉRIODE
  // (date_debut → date_fin), pas une journée : sa durée couvre tous les jours
  // ouvrés de l'intervalle. Compter une ligne pour un jour faisait passer une
  // absence d'une semaine pour une absence d'un jour (7 jours ouvrés et 56 h
  // affichés « 1 jour »). On compte donc les jours ouvrés de la période ; à
  // défaut de dates, la ligne vaut un jour.
  const injByEmployee = new Map<string, { nom: string; totalHrs: number; nbJours: number }>();
  for (const row of selectedMonthInjustifiees) {
    const code = row.code_salarie;
    const hrs = Number(row.duree_hrs || 0);
    const jours = joursOuvresEntre(row.date_debut as string, row.date_fin as string) || 1;
    const existing = injByEmployee.get(code);
    if (existing) {
      existing.totalHrs += hrs;
      existing.nbJours += jours;
    } else {
      injByEmployee.set(code, {
        nom: row.nom_salarie || "",
        totalHrs: hrs,
        nbJours: jours,
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

  // Départs prévisibles: employees with date_sortie after refDate but within the selected year
  const yearEnd = `${selectedYear}-12-31`;
  const departsPrevus = allEmployees.filter(
    (e) => e.date_sortie && e.date_sortie >= refDate && e.date_sortie <= yearEnd
  );

  // Gap vs cible
  const targetTotal = allTargets.reduce((sum, t) => sum + Number(t.target_headcount), 0);
  const gapVsCible = targetTotal > 0 ? Math.round((effectifNetEtp - targetTotal) * 10) / 10 : null;

  // ============================================================
  // Courbe d'évolution des effectifs (12 points) — calcul partagé avec la
  // page Coûts, voir lib/utils/wp-courbe-effectifs.ts
  // ============================================================

  const courbe = construireCourbeEffectifs({
    selectedYear,
    selectedMonth,
    now,
    anneeFuture,
    filtresActifs: filtres.actifs,
    targetTotal,
    photoDuMoisDe,
    photoExacte: (m, annee) => photoPourLeMois(photosParRang, m, annee).exacte,
    // Sortis du mois absents de la photo : repris seulement si le mois ET le
    // précédent ont chacun LEUR photo — comparer une photo reconduite à
    // elle-même n'apprend rien.
    sortisHorsPhotoPour: (m) => {
      const precM: MoisAnnee = m === 1 ? { mois: 12, annee: selectedYear - 1 } : { mois: m - 1, annee: selectedYear };
      if (!photoPourLeMois(photosParRang, m, selectedYear).exacte || !photoPourLeMois(photosParRang, precM.mois, precM.annee).exacte) return [];
      const codesPhotoM = new Set(photoDuMois(m).map((e) => e.code_salarie));
      return computeRosterMovements(
        photoDuMoisDe(precM.mois, precM.annee), photoDuMois(m), m, selectedYear,
        sortiesConstateesSur(m, selectedYear, precM)
      ).sortiesDefinitives
        .filter((i) => i.date && !codesPhotoM.has(i.code_salarie))
        .map((i) => ({ date_sortie: i.date!, taux_occupation: i.etp * 100 }));
    },
    absences,
    mctHorsWeekEnd,
    absencesInjustifiees,
    absencesAnneePrec,
    mctAnneePrec,
    injAnneePrec,
  });
  const { headcountData, etapesProjection, departProjection, avgAbsenteeism, cnsEstimatedFromMonth } = courbe;
  const lastKnownCnsRate = courbe.tauxRepris.cns?.taux ?? null;
  const lastKnownMctRate = courbe.tauxRepris.mct?.taux ?? null;
  const lastKnownInjRate = courbe.tauxRepris.inj?.taux ?? null;
  const lastKnownMctMonth: MoisAnnee | null = courbe.tauxRepris.mct ? { mois: courbe.tauxRepris.mct.mois, annee: courbe.tauxRepris.mct.annee } : null;
  const lastKnownInjMonth: MoisAnnee | null = courbe.tauxRepris.inj ? { mois: courbe.tauxRepris.inj.mois, annee: courbe.tauxRepris.inj.annee } : null;

  // ============================================================
  // Scenario projections for chart overlay
  // ============================================================

  const scenarioOptions: ScenarioOption[] = allScenariosRaw.map((s) => ({
    id: s.id,
    name: s.name,
  }));

  // Requêtes des tables wp_scenario_* (lignes brutes) ; le calcul lui-même
  // vit dans lib/utils/wp-projection-scenarios.ts.
  const scenarioIds = scenarioOptions.map((s) => s.id);
  const [scenarioParamsAll, scenarioTurnoverParamsAll, scenarioLeaveParamsAll, scenarioDeparturesAll, scenarioArrivalsAll, scenarioTempExitsAll, scenarioDetailsAll] = scenarioOptions.length > 0
    ? await Promise.all([
      fetchAll(supabase.from("wp_scenario_monthly_params").select("*").in("scenario_id", scenarioIds)),
      fetchAll(supabase.from("wp_scenario_monthly_turnover_params").select("*").in("scenario_id", scenarioIds)),
      fetchAll(supabase.from("wp_scenario_monthly_leave_params").select("*").in("scenario_id", scenarioIds)),
      fetchAll(supabase.from("wp_scenario_departures").select("*").in("scenario_id", scenarioIds)),
      fetchAll(supabase.from("wp_scenario_arrival_hypotheses").select("*").in("scenario_id", scenarioIds)),
      fetchAll(supabase.from("wp_scenario_temp_exit_hypotheses").select("*").in("scenario_id", scenarioIds)),
      fetchAll(supabase.from("wp_scenarios").select("id, projected_turnover_rate").in("id", scenarioIds)),
    ])
    : [[], [], [], [], [], [], []];

  const projection = projeterScenarios({
    scenarioOptions,
    selectedScenarioIds,
    turnoverSrcId,
    absSrcId,
    leaveSrcId,
    rows: {
      params: scenarioParamsAll,
      turnoverParams: scenarioTurnoverParamsAll,
      leaveParams: scenarioLeaveParamsAll,
      departures: scenarioDeparturesAll,
      arrivals: scenarioArrivalsAll,
      tempExits: scenarioTempExitsAll,
      details: scenarioDetailsAll,
    },
    selectedYear,
    selectedMonth,
    allEmployees,
    getActiveEmployeesAt,
    etapesProjection,
    departProjection,
    lastKnownCnsRate,
    lastKnownInjRate,
    lastKnownMctRate,
    // Muté pour scenario_apres_conges, comme avant
    headcountData,
  });
  const { scenarioProjections, scenarioKpiOverride, scenarioTurnoverLossesTotal, scenarioTurnoverLossesMoisAffiche } = projection;
  const {
    arrivals: hypArrivals,
    departures: hypDepartures,
    tempExits: hypTempExits,
    turnoverRates: hypTurnoverRates,
    absRates: hypAbsRates,
    leaveRates: hypLeaveRates,
    turnoverSrcName: hypTurnoverSrcName,
    absSrcName: hypAbsSrcName,
    leaveSrcName: hypLeaveSrcName,
  } = projection.hypotheses;

  // ============================================================
  // Taux MCT = total heures MCT / total heures travaillables ajustées au taux d'occupation
  // ============================================================

  const workableHrsSelectedMonth = getWorkableHoursInMonth(selectedYear, selectedMonth);
  // Base ajustée = heures travaillables * ETP disponible (suspensions partielles comprises)
  const totalAdjustedWorkableHrs = nonTempActiveAtRef.reduce(
    (sum, e) => sum + workableHrsSelectedMonth * getEtpDisponible(e, refDate), 0
  );
  const totalMctHrsSelected = selectedMonthMct.reduce(
    (sum, a) => sum + Number(a.duree_hrs || 0), 0
  );
  // Taux MCT: si pas de données pour le mois sélectionné, utiliser le dernier taux MCT connu
  const tauxMct = (selectedMonthMct.length > 0 && totalAdjustedWorkableHrs > 0)
    ? (totalMctHrsSelected / totalAdjustedWorkableHrs) * 100
    : (lastKnownMctRate ?? 0);

  // Taux absences injustifiées = total heures injustifiées / total heures travaillables ajustées
  const totalInjHrsSelected = selectedMonthInjustifiees.reduce(
    (sum, a) => sum + Number(a.duree_hrs || 0), 0
  );
  // Sans données pour le mois affiché, reprendre le dernier taux connu (comme CNS et MCT)
  const tauxInjustifiees = (selectedMonthInjustifiees.length > 0 && totalAdjustedWorkableHrs > 0)
    ? (totalInjHrsSelected / totalAdjustedWorkableHrs) * 100
    : (lastKnownInjRate ?? 0);
  // Signaler les taux qui ne sont pas mesurés sur le mois affiché mais repris
  // du dernier mois connu. Un scénario sélectionné prime sur le taux repris :
  // dans ce cas la valeur n'est plus une estimation et n'est pas marquée.
  const moisEstime = (m: MoisAnnee | null) => (m != null ? `${MONTH_LABELS[m.mois]} ${m.annee}` : null);
  const tauxAbsenteismeEstime = moisEstime(cnsEstimatedFromMonth);
  const tauxMctEstime =
    scenarioKpiOverride != null || selectedMonthMct.length > 0 ? null : moisEstime(lastKnownMctMonth);
  const tauxInjustifieesEstime =
    selectedMonthInjustifiees.length > 0 ? null : moisEstime(lastKnownInjMonth);

  // Heures derrière chaque taux, affichées seulement quand le taux est MESURÉ
  // sur le mois (ni repris d'un autre mois, ni remplacé par un scénario) :
  // sinon les heures ne correspondraient pas au pourcentage affiché à côté.
  const heuresCnsMesurees = absenteeismItems.reduce(
    (sum, a) => sum + a.hrs_maladie + a.hrs_accident + a.hrs_maternite + a.hrs_raisons_familiales + a.hrs_conge_accompagnement + a.hrs_accueil,
    0,
  );
  const heuresCns = scenarioKpiOverride == null && selectedMonthAbsences.length > 0 ? Math.round(heuresCnsMesurees) : null;
  const heuresMct = scenarioKpiOverride == null && selectedMonthMct.length > 0 ? Math.round(totalMctHrsSelected) : null;
  const heuresInjustifiees = selectedMonthInjustifiees.length > 0 ? Math.round(totalInjHrsSelected) : null;

  // ============================================================
  // Effectif MOYEN du mois en ETP (pondéré par les jours), à côté de la
  // valeur en fin de mois. Les sortis du mois absents de la photographie
  // sont repris des mouvements, pour que leurs jours de présence comptent.
  // Les taux d'absence sont déjà des moyennes du mois : on les applique à
  // l'effectif net moyen, comme la courbe les applique à l'effectif net.
  // Sans objet quand un scénario remplace les KPI.
  // ============================================================
  const sortisHorsPhoto = (mouvements?.sortiesDefinitives ?? [])
    .filter((i) => i.date && !employeeCodes.has(i.code_salarie))
    .map((i) => ({ date_sortie: i.date!, taux_occupation: i.etp * 100 }));
  const effectifMoyen = computeEffectifMoyen(allEmployees, sortisHorsPhoto, selectedMonth, selectedYear);
  const arrondi1 = (n: number) => Math.round(n * 10) / 10;

  // ============================================================
  // Turnover MENSUEL = sorties définitives du mois (ETP) hors fins de mission
  // / effectif moyen du mois (ETP). Annualisé = ×12 pour comparer à un taux
  // annuel. Arbitrage 2026-09-15 : donner une idée des départs DU MOIS, sans
  // y mêler les sorties prévues plus tard dans l'année.
  // Source : le panneau Mouvements (diff des photos M-1 → M, sorties datées
  // par l'IN/OUT ou les stats salariales, dernier jour du mois ⇒ mois
  // suivant). Sans photo précédente, repli sur les sorties datées de la photo
  // affichée prenant effet ce mois (sorties prévues seulement).
  // ============================================================
  // Hors turnover : les seules fins de mission (voir estSortieHorsTurnover)
  const estFinDeCdd = (motif: string | null | undefined) => estFinDeMission(motif);
  let sortiesMoisEtp: number;
  if (mouvements) {
    sortiesMoisEtp = mouvements.sortiesDefinitives
      .filter((i) => !estFinDeCdd(i.motif))
      .reduce((sum, i) => sum + i.etp, 0);
  } else {
    sortiesMoisEtp = allEmployees
      .filter((e) => {
        if (!e.date_sortie || estSortieHorsTurnover(e)) return false;
        const effet = moisEffetSortie(e.date_sortie);
        return effet.mois === selectedMonth && effet.annee === selectedYear;
      })
      .reduce((sum, e) => sum + getEtp(e), 0);
  }
  sortiesMoisEtp += scenarioTurnoverLossesMoisAffiche;
  const effectifMoyenMois = scenarioKpiOverride?.effectif_brut ?? effectifMoyen.brut;
  const tauxTurnoverMensuel = effectifMoyenMois > 0 ? (sortiesMoisEtp / effectifMoyenMois) * 100 : 0;
  const moyennes = scenarioKpiOverride == null
    ? (() => {
        const net = effectifMoyen.net;
        const apresCns = net - net * (avgAbsenteeism / 100);
        const apresInj = apresCns - net * (tauxInjustifiees / 100); // payé
        const apresMct = apresInj - net * (tauxMct / 100); // disponible
        return {
          effectif_brut_moyen: arrondi1(effectifMoyen.brut),
          effectif_net_moyen: arrondi1(net),
          effectif_apres_cns_moyen: arrondi1(apresCns),
          effectif_apres_mct_moyen: arrondi1(apresMct),
          effectif_apres_injustifiees_moyen: arrondi1(apresInj),
        };
      })()
    : {};

  const stats: WpDashboardStats = {
    ...moyennes,
    effectif_brut: scenarioKpiOverride?.effectif_brut ?? Math.round(effectifBrutEtp * 10) / 10,
    effectif_net: scenarioKpiOverride?.effectif_net ?? Math.round(effectifNetEtp * 10) / 10,
    bus_count: Math.round(busEtp * 10) / 10,
    cam_count: Math.round(camEtp * 10) / 10,
    headcount,
    taux_absenteisme: scenarioKpiOverride?.taux_absenteisme ?? avgAbsenteeism,
    taux_mct: scenarioKpiOverride?.taux_mct ?? tauxMct,
    taux_injustifiees: tauxInjustifiees,
    taux_absenteisme_estime: tauxAbsenteismeEstime,
    taux_mct_estime: tauxMctEstime,
    taux_injustifiees_estime: tauxInjustifieesEstime,
    heures_cns: heuresCns,
    heures_mct: heuresMct,
    heures_injustifiees: heuresInjustifiees,
    etp_total: scenarioKpiOverride?.effectif_brut ?? Math.round(effectifBrutEtp * 10) / 10,
    departs_prevus: departsPrevus.length,
    taux_turnover_mensuel: Math.round(tauxTurnoverMensuel * 100) / 100,
    taux_turnover_annualise: Math.round(tauxTurnoverMensuel * 12 * 10) / 10,
    sorties_mois_etp: arrondi1(sortiesMoisEtp),
    sorties_temporaires: scenarioKpiOverride?.sorties_temporaires ?? Math.round(sortiesTempEtp * 10) / 10,
    gap_vs_cible: scenarioKpiOverride
      ? (targetTotal > 0 ? Math.round((scenarioKpiOverride.effectif_net - targetTotal) * 10) / 10 : null)
      : gapVsCible,
    target_total: targetTotal > 0 ? targetTotal : null,
  };

  // ============================================================
  // Departures list
  // ============================================================

  const departureItems: DepartureItem[] = departsPrevus
    .sort((a, b) => (a.date_sortie || "").localeCompare(b.date_sortie || ""))
    .map((e) => ({
      code_salarie: e.code_salarie,
      nom_salarie: e.nom_salarie || null,
      vehicle_type: e.vehicle_type || "?",
      description_equipe: e.description_equipe || "",
      date_sortie: e.date_sortie!,
      motif: e.description_motif_sortie || "Non spécifié",
      type: e.est_sortie_temporaire ? "temporaire" as const : "definitive" as const,
    }));
  // Transferts À VENIR hors du périmètre : ceux du mois affiché sont dans le
  // panneau Mouvements, les cartes n'annoncent que les mois suivants.
  transfertsFuturs.sortants.forEach((i) => {
    departureItems.push({
      code_salarie: i.code_salarie,
      nom_salarie: i.nom_salarie,
      vehicle_type: i.vehicle_type,
      description_equipe: i.description_equipe,
      date_sortie: null,
      motif: i.motif,
      type: "transfert" as const,
    });
  });

  // ============================================================
  // Arrivals list
  // ============================================================

  // Nouveaux engagés À VENIR : entrée postérieure au mois affiché. Ceux du
  // mois lui-même figurent déjà dans « Mouvements du mois » (diff des photos) :
  // les lister ici aussi les montrait deux fois. Un roster historisé ne porte
  // que rarement des entrées futures, la catégorie est donc souvent vide.
  const nouveauxEngages = allEmployees.filter(
    (e) => e.date_entree && e.date_entree > refDate && e.date_entree <= yearEnd
  );

  // Retours de suspension à venir : encore suspendus à la date de référence
  // (fin de congé ≥ refDate). `date_fin_sortie_temporaire` est le DERNIER JOUR
  // du congé ; la reprise, affichée plus bas, est le lendemain.
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
        nom_salarie: e.nom_salarie || null,
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
        nom_salarie: e.nom_salarie || null,
        vehicle_type: e.vehicle_type || "?",
        description_equipe: e.description_equipe || "",
        date: jourSuivant(e.date_fin_sortie_temporaire!),
        motif: e.description_motif_sortie || "Non spécifié",
        type: "retour" as const,
      })),
  ];
  // Transferts À VENIR vers le périmètre (même règle que ci-dessus)
  transfertsFuturs.entrants.forEach((i) => {
    arrivalItems.push({
      code_salarie: i.code_salarie,
      nom_salarie: i.nom_salarie,
      vehicle_type: i.vehicle_type,
      description_equipe: i.description_equipe,
      date: null,
      motif: i.motif,
      type: "transfert" as const,
    });
  });

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
          {filtres.societes.length > 0 && ` — ${filtres.societes.join(" + ")}`}
          {selectedFonctions.length > 0 && ` — ${selectedFonctions.length} fonction(s)`}
          {selectedCC.length > 0 && ` — ${selectedCC.length} cost center(s)`}
          {selectedDepots.length > 0 && ` — ${selectedDepots.length} dépôt(s)`}
          {selectedContrats.length > 0 && ` — ${selectedContrats[0] === AUCUNE_VALEUR ? "aucun contrat" : selectedContrats.join(" + ")}`}
        </p>
      </div>

      {!rosterPeriodeExacte && rosterPeriode && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Aucun roster n&apos;a été importé pour {MONTH_LABELS[selectedMonth]} {selectedYear}.
          Les effectifs, départs et arrivées ci-dessous proviennent du roster de{" "}
          <strong>{MONTH_LABELS[rosterPeriode.mois]} {rosterPeriode.annee}</strong> et ne reflètent
          donc pas la situation telle qu&apos;elle était connue à la période demandée.
        </div>
      )}

      <WpKpiCards stats={stats} lienMethodologie={lienMethodologie} />

      <HeadcountEvolutionChart
        data={headcountData}
        scenarios={scenarioOptions}
        scenarioProjections={scenarioProjections}
        initialSelectedScenarios={selectedScenarioIds}
        initialTurnoverSrc={turnoverSrcId}
        initialAbsSrc={absSrcId}
        initialLeaveSrc={leaveSrcId}
        combinedProjection={scenarioProjections.find((sp) => sp.scenario_id === "__combined__") ?? null}
      />

      {targetTotal > 0 && <GapAnalysisChart data={gapData} />}

      <HeadcountTable items={headcountItems} />

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

      {mouvements && (
        <MovementsPanel
          movements={mouvements}
          moisPrecedentLabel={`${MONTH_LABELS[moisPrecedent.mois]} ${moisPrecedent.annee}`}
          moisLabel={`${MONTH_LABELS[selectedMonth]} ${selectedYear}`}
        />
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <DepartureTable departures={departureItems} />
        <ArrivalTable arrivals={arrivalItems} />
      </div>

      {selectedScenarioIds.length > 0 && (
        <ScenarioHypothesesCard
          arrivals={hypArrivals}
          departures={hypDepartures}
          tempExits={hypTempExits}
          turnoverRates={hypTurnoverRates}
          absRates={hypAbsRates}
          leaveRates={hypLeaveRates}
          turnoverSrcName={hypTurnoverSrcName}
          absSrcName={hypAbsSrcName}
          leaveSrcName={hypLeaveSrcName}
        />
      )}

    </div>
  );
}
