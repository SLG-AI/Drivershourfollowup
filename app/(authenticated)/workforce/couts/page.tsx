import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { rangPeriode, resolveRosterPeriod } from "@/lib/utils/roster-period";
import { ajouterPhotoSiAbsente, indexerPhotos, photoPourLeMois } from "@/lib/utils/roster-photos";
import { AUCUNE_VALEUR, lireFiltresWorkforce } from "@/lib/utils/wp-filtres";
import { computeRosterMovements, reclassifierSortiesTemporaires, sortiesConstateesSur } from "@/lib/utils/wp-movements";
import { construireCourbeEffectifs, type MoisAnnee } from "@/lib/utils/wp-courbe-effectifs";
import { construireCourbeCouts } from "@/lib/utils/wp-courbe-couts";
import { calculerCoefficientCharges, calculerCoefficientsParCostCenter, calculerComplementsRecurrents, construireSourceSalaires, fusionnerSourcesPaie, tauxComplementsDe, NATURES_RECURRENTES, type LignePaieDetaillee, type SalarieCout } from "@/lib/utils/wp-couts";
import { NATURES, decomposerParFamille, decomposerParMois, decomposerParNature, ventilerPar, type LignePaieDecomposable } from "@/lib/utils/wp-natures-paie";
import { PaieDecomposition, type NatureMontant } from "@/components/workforce/paie-decomposition";
import { PaieCase, type DetailCase, type DetailSection } from "@/components/workforce/paie-case";
import { FAMILLES } from "@/lib/utils/wp-natures-paie";
import { estActifLe } from "@/lib/utils/wp-effectif-moyen";
import { projeterScenarios } from "@/lib/utils/wp-projection-scenarios";
import { valoriserProjection } from "@/lib/utils/wp-couts-scenario";
import { LIBELLES_LEVIER, unite, type LevierCout } from "@/lib/utils/wp-leviers-cout";
import { LIBELLES_REPLI } from "@/lib/utils/wp-cout-moyen";
import { FRENCH_MONTHS_SHORT } from "@/lib/constants";
import { etpDe } from "@/lib/utils/wp-paliers";
import { horsWeekEnd, lastDayOfMonth } from "@/lib/utils/wp-calculations";
import { plafonnerTauxCns } from "@/lib/utils/wp-taux-cns";
import { formatEuros } from "@/lib/utils/format";
import { HeadcountEvolutionChart, type ScenarioOption, type ScenarioProjectionData } from "@/components/workforce/headcount-evolution-chart";
import { CostKpiCards, type CoutsStats } from "@/components/workforce/cost-kpi-cards";
import { pasAxeEuros, SERIES_COUTS } from "@/components/workforce/cost-series";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Upload } from "lucide-react";

const MONTH_LABELS: Record<number, string> = {
  1: "Janvier", 2: "Février", 3: "Mars", 4: "Avril",
  5: "Mai", 6: "Juin", 7: "Juillet", 8: "Août",
  9: "Septembre", 10: "Octobre", 11: "Novembre", 12: "Décembre",
};

interface Props {
  searchParams: Promise<{ year?: string; month?: string; societes?: string; fonctions?: string; cc?: string; depots?: string; equipes?: string; contrats?: string; employee?: string; scenarios?: string; turnover_src?: string; abs_src?: string; leave_src?: string }>;
}

/**
 * Page Coûts : la courbe d'évolution des effectifs, en euros. Même chargement
 * et mêmes photos par mois que le tableau de bord ; les paliers ETP viennent
 * de `construireCourbeEffectifs`, leur valorisation de `construireCourbeCouts`.
 */
export default async function WorkforceCoutsPage({ searchParams }: Props) {
  const params = await searchParams;
  const supabase = await createClient();
  const now = new Date();
  const selectedYear = params.year ? parseInt(params.year) : now.getFullYear();
  const selectedMonth = params.month ? parseInt(params.month) : now.getMonth() + 1;
  const filtres = lireFiltresWorkforce(params);
  const refDate = lastDayOfMonth(selectedYear, selectedMonth);
  const moisLabel = `${MONTH_LABELS[selectedMonth]} ${selectedYear}`;
  const selectedScenarioIds = params.scenarios ? params.scenarios.split(",").filter(Boolean) : [];
  const turnoverSrcId = params.turnover_src || null;
  const absSrcId = params.abs_src || null;
  const leaveSrcId = params.leave_src || null;

  const qsMethodologie = new URLSearchParams();
  (["year", "month", "societes", "fonctions", "cc", "depots", "equipes", "contrats", "employee"] as const).forEach((k) => {
    const v = params[k];
    if (v) qsMethodologie.set(k, v);
  });
  const lienMethodologie = `/workforce/methodologie${qsMethodologie.size ? `?${qsMethodologie}` : ""}`;

  const { count: employeeCount } = await supabase.from("wp_employees").select("*", { count: "exact", head: true });
  if (!employeeCount) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Coûts</h1>
          <p className="text-muted-foreground">Masse salariale et projection des coûts.</p>
        </div>
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12">
          <p className="text-lg font-medium">Aucune donnée disponible</p>
          <p className="mt-2 text-sm text-muted-foreground">Importez vos fichiers RH pour commencer.</p>
          <Button asChild className="mt-4">
            <Link href="/workforce/import"><Upload className="mr-2 h-4 w-4" />Importer des données</Link>
          </Button>
        </div>
      </div>
    );
  }

  const { periode: rosterPeriode, exacte: rosterPeriodeExacte } = await resolveRosterPeriod(supabase, selectedMonth, selectedYear);
  const anneeFuture = selectedYear > now.getFullYear();
  const colonnesPhoto = "code_salarie, code_employeur, mois, annee, date_entree, date_sortie, date_debut_sortie_temporaire, date_fin_sortie_temporaire, taux_occupation, est_sortie_temporaire, description_motif_sortie, description_fonction, centre_cout, description_service, description_equipe, type_contrat, brut_indice";

  const [employees, absences, salaryStats, absencesMct, absencesInjustifiees, mouvementsSirh, photosAnnee, absencesAnneePrec, mctAnneePrec, injAnneePrec, periodeReference, dernierMoisStats, allScenariosRaw, salaryLines, dernierMoisPaie] = await Promise.all([
    fetchAll(supabase.from("wp_employees").select("*").eq("mois", rosterPeriode?.mois ?? -1).eq("annee", rosterPeriode?.annee ?? -1)),
    fetchAll(supabase.from("wp_absences").select("*").eq("annee", selectedYear)).then(plafonnerTauxCns),
    fetchAll(supabase.from("wp_salary_stats").select("code_salarie, mois, annee, date_sortie, centre_cout, hrs_supp, total_brut, brut_base, supplements, cout_total_secu, charges_patronales, cm_patronale, cp_patronale, assurance_accident, allocation_familiale, sante_travail, mutualite, cot_pat_autres").eq("annee", selectedYear)),
    fetchAll(supabase.from("wp_absences_mct").select("*").eq("annee", selectedYear)),
    fetchAll(supabase.from("wp_absences_injustifiees").select("*").eq("annee", selectedYear)),
    fetchAll(supabase.from("wp_mouvements").select("code_salarie, type, date_sortie, motif_sortie, mois, annee").in("annee", [selectedYear, selectedYear - 1]).in("type", ["sortie", "sortie_temporaire"])),
    // Toutes les photos de l'année, AVEC le brut indice : chaque mois se lit dans sa photo
    fetchAll(supabase.from("wp_employees").select(colonnesPhoto).eq("annee", selectedYear)),
    anneeFuture ? fetchAll(supabase.from("wp_absences").select("code_salarie, mois, pct_absenteisme, hrs_maladie").eq("annee", selectedYear - 1)).then(plafonnerTauxCns) : Promise.resolve([] as Record<string, unknown>[]),
    anneeFuture ? fetchAll(supabase.from("wp_absences_mct").select("code_salarie, mois, date_absence, duree_hrs").eq("annee", selectedYear - 1)) : Promise.resolve([] as Record<string, unknown>[]),
    anneeFuture ? fetchAll(supabase.from("wp_absences_injustifiees").select("code_salarie, mois, duree_hrs").eq("annee", selectedYear - 1)) : Promise.resolve([] as Record<string, unknown>[]),
    // Photo de référence salariale : la plus récente qui porte un brut indice
    supabase.from("wp_employees").select("mois, annee").gt("brut_indice", 0).order("annee", { ascending: false }).order("mois", { ascending: false }).limit(1).maybeSingle(),
    // Dernier mois de statistiques salariales avec montants, pour le coefficient de charges
    supabase.from("wp_salary_stats").select("mois, annee").gt("charges_patronales", 0).order("annee", { ascending: false }).order("mois", { ascending: false }).limit(1).maybeSingle(),
    fetchAll(supabase.from("wp_scenarios").select("id, name").order("created_at", { ascending: false })),
    // Liste des salaires de l'année : brut par nature et coût employeur de la paie
    fetchAll(supabase.from("wp_salary_lines").select("*").eq("annee", selectedYear)),
    // Dernier mois de Liste des salaires avec charges, pour le coefficient
    supabase.from("wp_salary_lines").select("mois, annee").gt("charges_patronales", 0).order("annee", { ascending: false }).order("mois", { ascending: false }).limit(1).maybeSingle(),
  ]);
  // Scénarios : mêmes lignes brutes que le tableau de bord, plus les leviers de coût
  const scenarioOptions: ScenarioOption[] = allScenariosRaw.map((s) => ({ id: String(s.id), name: String(s.name) }));
  const scenarioIds = scenarioOptions.map((s) => s.id);
  const [scParams, scTurnover, scLeave, scDepartures, scArrivals, scTempExits, scDetails, scCostParams] = scenarioOptions.length > 0
    ? await Promise.all([
      fetchAll(supabase.from("wp_scenario_monthly_params").select("*").in("scenario_id", scenarioIds)),
      fetchAll(supabase.from("wp_scenario_monthly_turnover_params").select("*").in("scenario_id", scenarioIds)),
      fetchAll(supabase.from("wp_scenario_monthly_leave_params").select("*").in("scenario_id", scenarioIds)),
      fetchAll(supabase.from("wp_scenario_departures").select("*").in("scenario_id", scenarioIds)),
      fetchAll(supabase.from("wp_scenario_arrival_hypotheses").select("*").in("scenario_id", scenarioIds)),
      fetchAll(supabase.from("wp_scenario_temp_exit_hypotheses").select("*").in("scenario_id", scenarioIds)),
      fetchAll(supabase.from("wp_scenarios").select("id, projected_turnover_rate").in("id", scenarioIds)),
      selectedScenarioIds.length > 0
        ? fetchAll(supabase.from("wp_scenario_cost_params").select("*").in("scenario_id", selectedScenarioIds))
        : Promise.resolve([] as Record<string, unknown>[]),
    ])
    : [[], [], [], [], [], [], [], []];

  const periodeRef: MoisAnnee | null = periodeReference.data ? { mois: Number(periodeReference.data.mois), annee: Number(periodeReference.data.annee) } : null;
  const [photoReference, statsCoefficient, lignesCoefficient] = await Promise.all([
    periodeRef
      ? fetchAll(supabase.from("wp_employees").select(colonnesPhoto).eq("mois", periodeRef.mois).eq("annee", periodeRef.annee))
      : Promise.resolve(null),
    dernierMoisStats.data && Number(dernierMoisStats.data.annee) !== selectedYear
      ? fetchAll(supabase.from("wp_salary_stats").select("code_salarie, mois, annee, centre_cout, total_brut, charges_patronales").eq("mois", dernierMoisStats.data.mois).eq("annee", dernierMoisStats.data.annee))
      : Promise.resolve([] as Record<string, unknown>[]),
    dernierMoisPaie.data && Number(dernierMoisPaie.data.annee) !== selectedYear
      ? fetchAll(supabase.from("wp_salary_lines").select("code_salarie, mois, annee, type_remuneration, centre_cout, total_brut, brut_base, charges_patronales, cout_employeur").eq("mois", dernierMoisPaie.data.mois).eq("annee", dernierMoisPaie.data.annee))
      : Promise.resolve([] as Record<string, unknown>[]),
  ]);
  // Une seule liste de paie : la Liste des salaires remplace les Statistiques
  // rapides sur les mois qu'elle couvre (coût employeur de la paie, brut
  // décomposé) ; les autres mois gardent les Statistiques rapides.
  const paie = fusionnerSourcesPaie(
    [...salaryStats, ...statsCoefficient],
    [...salaryLines, ...lignesCoefficient] as unknown as LignePaieDetaillee[]
  );

  // ---- Filtres, reclassification, photos par mois : mêmes règles que le tableau de bord
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const passeLesFiltres = (e: any) => filtres.passe(e);
  const allEmployees = employees.filter(passeLesFiltres);
  const employeeCodes = new Set<string>(allEmployees.map((e) => String(e.code_salarie)));
  const allAbsences = absences.filter((a) => employeeCodes.has(String(a.code_salarie)));
  const mctHorsWeekEnd = horsWeekEnd(absencesMct);
  const codesMaladieAnneePrec = anneeFuture
    ? absencesAnneePrec.filter((a) => Number(a.hrs_maladie || 0) > 0).map((a) => String(a.code_salarie))
    : [];
  reclassifierSortiesTemporaires(allEmployees, new Set([
    ...allAbsences.filter((a) => Number(a.hrs_maladie || 0) > 0).map((a) => String(a.code_salarie)),
    ...codesMaladieAnneePrec,
  ]));

  const photosParRang = indexerPhotos(photosAnnee);
  ajouterPhotoSiAbsente(photosParRang, rosterPeriode, employees);
  const codesAvecMaladieCnsAnnee = new Set([
    ...absences.filter((a) => Number(a.hrs_maladie || 0) > 0).map((a) => String(a.code_salarie)),
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

  // ---- Les douze points en ETP (calcul partagé avec le tableau de bord)
  const courbe = construireCourbeEffectifs({
    selectedYear,
    selectedMonth,
    now,
    anneeFuture,
    filtresActifs: filtres.actifs,
    targetTotal: 0,
    photoDuMoisDe,
    photoExacte: (m, annee) => photoPourLeMois(photosParRang, m, annee).exacte,
    sortisHorsPhotoPour: (m) => {
      const precM: MoisAnnee = m === 1 ? { mois: 12, annee: selectedYear - 1 } : { mois: m - 1, annee: selectedYear };
      if (!photoPourLeMois(photosParRang, m, selectedYear).exacte || !photoPourLeMois(photosParRang, precM.mois, precM.annee).exacte) return [];
      const codesPhotoM = new Set(photoDuMois(m).map((e) => e.code_salarie));
      return computeRosterMovements(
        photoDuMoisDe(precM.mois, precM.annee), photoDuMois(m), m, selectedYear,
        sortiesConstateesSur(mouvementsSirh, salaryStats, m, selectedYear, precM)
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

  // ---- Valorisation
  const coefficient = calculerCoefficientCharges(paie, filtres.actifs ? employeeCodes : undefined);
  // Coefficient par cost center, lu dans la paie quand elle porte les charges patronales
  const coefParCc = calculerCoefficientsParCostCenter(paie);
  // Compléments récurrents (13e mois proratisé, prime de fonction) : taux mesurés sur la Liste des salaires
  const complements = calculerComplementsRecurrents([...salaryLines, ...lignesCoefficient] as unknown as LignePaieDetaillee[]);
  const courbeCouts = construireCourbeCouts({
    headcountData: courbe.headcountData,
    selectedYear,
    filtresActifs: filtres.actifs,
    photoDuMois,
    photoReference: photoReference as SalarieCout[] | null,
    coef: coefficient.coef,
    coefParCc,
    complements,
    absences,
    mctHorsWeekEnd,
    absencesInjustifiees,
    stats: paie,
  });
  const points = courbeCouts.map((p) => p.point);
  const duMois = courbeCouts[selectedMonth - 1];
  const aucunSalaire = photoReference == null;

  // ---- Scénarios : projection en ETP (moteur partagé), puis valorisation en euros
  const getActiveEmployeesAt = (date: string) => allEmployees.filter((e) => estActifLe(e, date));
  const projection = projeterScenarios({
    scenarioOptions, selectedScenarioIds, turnoverSrcId, absSrcId, leaveSrcId,
    rows: { params: scParams, turnoverParams: scTurnover, leaveParams: scLeave, departures: scDepartures, arrivals: scArrivals, tempExits: scTempExits, details: scDetails },
    selectedYear, selectedMonth, allEmployees, getActiveEmployeesAt,
    etapesProjection: courbe.etapesProjection, departProjection: courbe.departProjection, lastKnownCnsRate: courbe.tauxRepris.cns?.taux ?? null, lastKnownInjRate: courbe.tauxRepris.inj?.taux ?? null, lastKnownMctRate: courbe.tauxRepris.mct?.taux ?? null,
    headcountData: courbe.headcountData,
  });
  // Leviers des scénarios sélectionnés, additionnés (hausses, primes) ; le
  // seuil SSM et le coefficient forcé les plus récents l'emportent.
  const leviers: LevierCout[] = scCostParams.map((r) => ({
    id: String(r.id), scenario_id: String(r.scenario_id), type: r.type as LevierCout["type"], centre_cout: (r.centre_cout as string) || null,
    annee_effet: Number(r.annee_effet), mois_effet: Number(r.mois_effet), valeur: Number(r.valeur), mode: r.mode as LevierCout["mode"], libelle: (r.libelle as string) || null,
  }));
  let scenarioProjectionsCouts: ScenarioProjectionData[] = [];
  let valorisation: ReturnType<typeof valoriserProjection> | null = null;
  if (projection.journalCombine && projection.journalCombine.length > 0 && !aucunSalaire) {
    // Photo de départ : le dernier mois réel de l'année affichée, sinon (année
    // future) le mois courant lu dans la dernière photo — comme departProjection.
    const lastRealIdx = courbe.headcountData.findIndex((d) => d.is_projection) - 1;
    const photoDepart = lastRealIdx >= 0
      ? (photoDuMois(lastRealIdx + 1) as SalarieCout[]).filter((e) => estActifLe(e, lastDayOfMonth(selectedYear, lastRealIdx + 1)))
      : (photoDuMoisDe(now.getMonth() + 1, now.getFullYear()) as SalarieCout[]).filter((e) => estActifLe(e, lastDayOfMonth(now.getFullYear(), now.getMonth() + 1)));
    valorisation = valoriserProjection(projection.journalCombine, {
      photoDepart,
      source: construireSourceSalaires(photoDepart, photoReference as SalarieCout[] | null),
      populationReference: (photoReference ?? []) as SalarieCout[],
      coefBase: coefficient.coef,
      leviers,
      premierMoisProjete: courbe.etapesProjection[0] ?? { mois: selectedMonth, annee: selectedYear },
      coutEtpDefaut: duMois.couts.coutMoyenEtp,
      complements,
    });
    scenarioProjectionsCouts = [{
      scenario_id: "__combined__",
      months: valorisation.mois.filter((m) => m.annee === selectedYear).map((m) => ({
        month_index: m.mois, scenario_brut: m.scenario_brut, scenario_net: m.scenario_net, scenario_reel: m.scenario_reel,
        scenario_apres_injustifiees: m.scenario_apres_injustifiees, scenario_apres_mct: m.scenario_apres_mct, scenario_apres_conges: m.scenario_apres_conges,
      })),
    }];
  }
  const masseAnnuelleScenario = valorisation
    ? points.reduce((s, p, i) => s + (scenarioProjectionsCouts[0].months.find((m) => m.month_index === i + 1)?.scenario_brut ?? p.effectif_brut), 0)
    : undefined;

  // ---- Cartes KPI du mois affiché
  const sourceDuMois = construireSourceSalaires(photoDuMois(selectedMonth), photoReference as SalarieCout[] | null);
  const actifsDuMois = (photoDuMois(selectedMonth) as SalarieCout[]).filter((e) => estActifLe(e, refDate));
  const etpSousContrat = actifsDuMois.reduce((s, e) => s + etpDe(e), 0);
  const moyenne = duMois.point.moyenne;
  const stats: CoutsStats = {
    sous_contrat: duMois.couts.sousContrat,
    cout_suspendu: duMois.couts.coutSuspendu,
    apres_suspension: duMois.couts.apresSuspension,
    cout_perdu_cns: duMois.point.effectif_reel != null ? duMois.couts.apresSuspension - duMois.point.effectif_reel : duMois.couts.coutPerduCns,
    cout_perdu_injustifiees: duMois.point.effectif_reel != null && duMois.point.effectif_apres_injustifiees != null ? duMois.point.effectif_reel - duMois.point.effectif_apres_injustifiees : duMois.couts.coutPerduInjustifiees,
    paye: duMois.point.effectif_apres_injustifiees,
    cout_perdu_mct: duMois.point.effectif_apres_injustifiees != null && duMois.point.effectif_apres_mct != null ? duMois.point.effectif_apres_injustifiees - duMois.point.effectif_apres_mct : undefined,
    disponible: duMois.point.effectif_apres_mct,
    sous_contrat_moyen: moyenne?.effectif_brut,
    apres_suspension_moyen: moyenne?.effectif_net,
    paye_moyen: moyenne?.effectif_apres_injustifiees,
    realise: duMois.realise.mesure ? (duMois.realise.employeurMesure ? duMois.realise.employeur : duMois.realise.brut * coefficient.coef) : null,
    realise_estime: duMois.realise.mesure && !duMois.realise.employeurMesure,
    realise_brut: duMois.realise.mesure ? duMois.realise.brut : null,
    realise_lignes: duMois.realise.n,
    coefficient: coefficient.coef,
    coefficient_source: coefficient.source
      ? `Calculé sur ${MONTH_LABELS[coefficient.source.mois]} ${coefficient.source.annee} (${coefficient.source.n.toLocaleString("fr-FR")} lignes, ${coefficient.source.perimetre === "filtre" ? "périmètre filtré" : "toute l'entreprise"})`
      : null,
    cout_moyen_etp: duMois.couts.coutMoyenEtp,
    brut_plein_temps_moyen: coefficient.coef > 0 ? duMois.couts.coutMoyenEtp / coefficient.coef / (1 + (complements?.global.taux ?? 0)) : 0,
    complements_recurrents: duMois.couts.complementsRecurrents,
    taux_complements: complements?.global.taux ?? null,
    complements_source: complements ? `${MONTH_LABELS[complements.mois]} ${complements.annee}` : null,
    etp_sous_contrat: etpSousContrat,
    masse_annuelle: points.reduce((s, p) => s + p.effectif_brut, 0),
    mois_reportes: points.filter((p) => p.reporte?.brut).length,
    codes_sans_salaire: duMois.couts.reporte.codesManquants,
    mois_label: moisLabel,
    reference_label: sourceDuMois.reporte && periodeRef ? `${MONTH_LABELS[periodeRef.mois]} ${periodeRef.annee}` : null,
    masse_annuelle_scenario: masseAnnuelleScenario,
  };

  // ---- Coût moyen par cost center du mois affiché (aide à lire les repli des scénarios)
  const parCostCenter = new Map<string, { n: number; etp: number; brutPleinTemps: number; avecBrut: number; cout: number }>();
  actifsDuMois.forEach((e) => {
    const cc = e.centre_cout || "(sans cost center)";
    const ligne = parCostCenter.get(cc) ?? { n: 0, etp: 0, brutPleinTemps: 0, avecBrut: 0, cout: 0 };
    const brut = sourceDuMois.brutDe(e.code_salarie);
    const coefCc = (e.centre_cout && coefParCc.get(e.centre_cout)?.coef) || coefficient.coef;
    ligne.n += 1;
    ligne.etp += etpDe(e);
    if (brut != null) {
      ligne.avecBrut += 1;
      ligne.brutPleinTemps += brut;
      ligne.cout += brut * (1 + tauxComplementsDe(complements, e.centre_cout)) * etpDe(e) * coefCc;
    } else {
      ligne.cout += duMois.couts.coutMoyenEtp * etpDe(e);
    }
    parCostCenter.set(cc, ligne);
  });
  const lignesCostCenter = [...parCostCenter.entries()]
    .map(([cc, l]) => ({ cc, ...l, brutMoyen: l.avecBrut > 0 ? l.brutPleinTemps / l.avecBrut : null, coutEtp: l.etp > 0 ? l.cout / l.etp : null }))
    .sort((a, b) => b.cout - a.cout);

  // ---- Décomposition de la paie par famille de natures (Liste des salaires)
  const lignesPaie = salaryLines as unknown as LignePaieDecomposable[];
  const codesPerimetre = filtres.actifs ? employeeCodes : undefined;
  const paieParMois = decomposerParMois(lignesPaie, selectedYear, codesPerimetre);
  const lignesPaieDuMois = lignesPaie.filter((l) => Number(l.mois) === selectedMonth && (!codesPerimetre || codesPerimetre.has(l.code_salarie)));
  const paieDuMois = lignesPaieDuMois.length > 0
    ? {
      familles: decomposerParFamille(lignesPaieDuMois),
      brut: lignesPaieDuMois.reduce((s, l) => s + Number(l.total_brut || 0), 0),
      n: lignesPaieDuMois.length,
      nonPeriodiques: lignesPaieDuMois.filter((l) => l.type_remuneration === "non_periodique").length,
    }
    : null;
  const montantsNatures = decomposerParNature(lignesPaieDuMois);
  const naturesDuMois: NatureMontant[] = NATURES
    .map((n) => ({ cle: n.cle, libelle: n.libelle, famille: n.famille, montant: montantsNatures.get(n.cle) ?? 0 }))
    .filter((n) => Math.abs(n.montant) >= 0.005)
    .sort((a, b) => Math.abs(b.montant) - Math.abs(a.montant));
  // Dépôt : le service du roster du mois (la paie n'en porte pas)
  const depotParCode = new Map<string, string>();
  (photoDuMois(selectedMonth) as SalarieCout[]).forEach((e) => depotParCode.set(e.code_salarie, e.description_service || ""));
  const paieParDepot = ventilerPar(lignesPaieDuMois, (l) => depotParCode.get(l.code_salarie), "(hors photo roster)");
  const paieParFonction = ventilerPar(lignesPaieDuMois, (l) => l.fonction, "(sans fonction)");

  // ---- Détails des cases « Paie réalisée » (Liste des salaires seulement :
  // les Statistiques rapides n'ont qu'un bloc « Suppléments » indivisible)
  const realiseDuMois = duMois.realise;
  const detailsPaie = realiseDuMois.source === "lignes" ? construireDetailsPaie() : null;
  function construireDetailsPaie(): Record<"supplements" | "cm" | "charges" | "avantages" | "soldes" | "ecart", DetailCase | null> {
    const brut = realiseDuMois.brut;
    const part = (n: number) => (brut > 0 ? (n / brut) * 100 : null);
    const somme = (cle: string, lignes: LignePaieDecomposable[] = lignesPaieDuMois) => lignes.reduce((acc, l) => acc + Number((l as unknown as Record<string, unknown>)[cle] || 0), 0);
    const lienDecomposition = { href: "#decomposition-paie", libelle: "Voir la décomposition par dépôt et fonction" };

    // Suppléments : les natures, par famille (le brut de base n'en fait pas partie)
    const sectionsSupplements: DetailSection[] = FAMILLES.map((f) => {
      const lignes = naturesDuMois.filter((n) => n.famille === f.id).map((n) => ({ libelle: n.libelle, montant: n.montant, part: part(n.montant) }));
      const montant = lignes.reduce((acc, l) => acc + l.montant, 0);
      return { titre: f.libelle, montant, part: part(montant), ouvert: f.id === "planning", lignes };
    }).filter((sec) => sec.lignes.length > 0);
    const supplements: DetailCase = {
      sousTitre: `${(part(realiseDuMois.supplements) ?? 0).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} % du total brut · tout ce qui s'ajoute au brut de base`,
      sections: sectionsSupplements,
      note: "Part = montant / total brut du mois. Les régularisations sont des retenues (négatives).",
      lien: lienDecomposition,
    };

    const cm: DetailCase = {
      sousTitre: "Caisse maladie, part employeur",
      sections: [{ titre: "Détail", ouvert: true, lignes: [
        { libelle: "CM patronale soins", montant: somme("cm_patronale_soins") },
        { libelle: "CM patronale espèces", montant: somme("cm_patronale_especes") },
      ] }],
    };

    const ch = realiseDuMois.charges;
    const charges: DetailCase = {
      sousTitre: `${(brut > 0 ? (realiseDuMois.chargesPatronales / brut) * 100 : 0).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} % du total brut`,
      sections: [{ titre: "Cotisations patronales", ouvert: true, lignes: [
        { libelle: "CM patronale (soins + espèces)", montant: ch.cm, part: part(ch.cm) },
        { libelle: "CP patronale", montant: ch.cp, part: part(ch.cp) },
        { libelle: "Assurance accident", montant: ch.accident, part: part(ch.accident) },
        { libelle: "Santé au travail", montant: ch.sante, part: part(ch.sante) },
        { libelle: "Mutualité", montant: ch.mutualite, part: part(ch.mutualite) },
        { libelle: "Autres cotisations patronales", montant: ch.autres, part: part(ch.autres) },
      ] }],
      note: "Les cotisations salariales, l'impôt et le net ne sont pas importés : ils ne changent pas ce que l'employeur décaisse.",
    };

    const naturesAvantages = naturesDuMois.filter((n) => n.famille === "avantages");
    const avantages: DetailCase = {
      sousTitre: "Valorisés dans le brut pour l'impôt, retirés du coût par la paie",
      sections: [
        { titre: "Natures d'avantages dans le brut", montant: naturesAvantages.reduce((acc, n) => acc + n.montant, 0), ouvert: true, lignes: naturesAvantages.map((n) => ({ libelle: n.libelle, montant: n.montant })) },
        { titre: "Déduits du coût employeur par la paie", montant: realiseDuMois.avantagesNature, ouvert: true, lignes: [] },
      ],
      note: "Déduits = total brut + charges patronales − coût natures déduites. Un avantage peut figurer dans le brut sans être déduit (allocation en espèces).",
    };

    const np = lignesPaieDuMois.filter((l) => l.type_remuneration === "non_periodique");
    const naturesNp = decomposerParNature(np);
    const soldes: DetailCase = {
      sousTitre: `${np.length} ligne${np.length > 1 ? "s" : ""} « Rémun. np » (période 13), rattachée${np.length > 1 ? "s" : ""} au mois de l'export`,
      sections: [
        { titre: "Par nature (brut)", montant: realiseDuMois.nonPeriodique.brut, ouvert: true, lignes: NATURES.filter((n) => Math.abs(naturesNp.get(n.cle) ?? 0) >= 0.005).map((n) => ({ libelle: n.libelle, montant: naturesNp.get(n.cle) ?? 0 })) },
        { titre: "Charges patronales sur ces lignes", montant: somme("charges_patronales", np), lignes: [] },
        { titre: "Coût employeur (compté dans le réalisé)", montant: realiseDuMois.nonPeriodique.employeur, lignes: [] },
      ],
      note: "Hors masse salariale courante et hors coefficient : décaissés ce mois, mais ne décrivent pas la paie d'un mois normal.",
    };

    // Écart réalisé − payé : réconciliation, natures chargées au coefficient réel du mois
    let ecart: DetailCase | null = null;
    if (stats.paye != null && stats.realise != null && brut > 0) {
      const coefReel = realiseDuMois.employeur / brut;
      const total = stats.realise - stats.paye;
      const regul = naturesDuMois.filter((n) => n.famille === "regularisations").reduce((acc, n) => acc + n.montant, 0);
      const soldesBrut = realiseDuMois.nonPeriodique.brut;
      // Le 13e mois proratisé et la prime de fonction sont déjà dans le contractuel (taux mesuré) : hors de l'écart
      const clesRecurrentes = new Set<string>(NATURES_RECURRENTES.map((n) => n.cle));
      const recurrents = naturesDuMois.filter((n) => clesRecurrentes.has(n.cle)).reduce((acc, n) => acc + n.montant, 0);
      const supplementsVariables = realiseDuMois.supplements - soldesBrut - regul - recurrents;
      const lignesEcart = [
        { libelle: "Suppléments variables du mois, chargés (natures × coefficient réel, hors 13e mois et prime de fonction déjà au contractuel)", montant: supplementsVariables * coefReel },
        { libelle: "Régularisations, chargées (retenues)", montant: regul * coefReel },
        { libelle: "Soldes de sortie (coût employeur)", montant: realiseDuMois.nonPeriodique.employeur },
      ];
      const explique = lignesEcart.reduce((acc, l) => acc + l.montant, 0);
      lignesEcart.push({ libelle: "Reste : prorata des entrées et sorties, écart brut indice / brut payé, compléments récurrents réels vs taux, avantages déduits", montant: total - explique });
      ecart = {
        sousTitre: `Réalisé ${formatEuros(stats.realise)} − payé contractuel ${formatEuros(stats.paye)}`,
        sections: [{ titre: "D'où vient l'écart", montant: total, ouvert: true, lignes: lignesEcart }],
        note: `Estimation : les natures de paie sont chargées au coefficient réel du mois (${coefReel.toLocaleString("fr-FR", { maximumFractionDigits: 3 })}) ; le « reste » est obtenu par différence.`,
      };
    }

    return { supplements, cm, charges, avantages, soldes, ecart };
  }

  const maxValeur = Math.max(0, ...points.map((p) => p.effectif_brut));
  const filtresDesc = [
    filtres.societes.length > 0 ? filtres.societes.join(" + ") : null,
    filtres.fonctions.length > 0 ? `${filtres.fonctions.length} fonction(s)` : null,
    filtres.cc.length > 0 ? `${filtres.cc.length} cost center(s)` : null,
    filtres.depots.length > 0 ? `${filtres.depots.length} dépôt(s)` : null,
    filtres.contrats.length > 0 ? (filtres.contrats[0] === AUCUNE_VALEUR ? "aucun contrat" : filtres.contrats.join(" + ")) : null,
    filtres.employee ? `salarié ${filtres.employee}` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Coûts</h1>
        <p className="text-muted-foreground">
          Masse salariale employeur — {moisLabel}
          {filtresDesc.map((f) => ` — ${f}`).join("")}
        </p>
      </div>

      {!rosterPeriodeExacte && rosterPeriode && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Aucun roster n&apos;a été importé pour {moisLabel}. Les effectifs proviennent du roster de{" "}
          <strong>{MONTH_LABELS[rosterPeriode.mois]} {rosterPeriode.annee}</strong>.
        </div>
      )}
      {aucunSalaire ? (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          Aucun roster importé ne porte de salaire (colonne « Brut indice » vide) : les coûts contractuels ne peuvent pas être calculés.
          Importez un roster avec salaires pour activer cette page.
        </div>
      ) : (
        sourceDuMois.reporte && periodeRef && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Le roster de {moisLabel} ne porte pas de salaire : les bruts sont lus dans celui de{" "}
            <strong>{MONTH_LABELS[periodeRef.mois]} {periodeRef.annee}</strong>, la dernière photo qui en porte. Les coûts de ce mois sont donc reportés (pointillé).
          </div>
        )
      )}
      {!coefficient.source && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Aucun mois de statistiques salariales ne porte de charges patronales : le coefficient de charges est la valeur par défaut ({coefficient.coef.toLocaleString("fr-FR", { minimumFractionDigits: 2 })}).
          Importez une « Liste des salaires » (ou des « Statistiques rapides » complètes, avec les cotisations patronales) pour le calculer sur le réalisé.
        </div>
      )}

      {!aucunSalaire && <CostKpiCards stats={stats} lienMethodologie={lienMethodologie} />}

      {!aucunSalaire && (
        <HeadcountEvolutionChart
          data={points}
          title="Évolution des coûts"
          series={SERIES_COUTS}
          unite="euros"
          axeStep={pasAxeEuros(maxValeur)}
          brushDataKey="effectif_brut"
          libelleVide="Importez un roster avec salaires pour visualiser l'évolution des coûts."
          scenarios={scenarioOptions}
          scenarioProjections={scenarioProjectionsCouts}
          initialSelectedScenarios={selectedScenarioIds}
          initialTurnoverSrc={turnoverSrcId}
          initialAbsSrc={absSrcId}
          initialLeaveSrc={leaveSrcId}
          combinedProjection={scenarioProjectionsCouts[0] ?? null}
        />
      )}

      {valorisation && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Valorisation du scénario — d&apos;où viennent les coûts</CardTitle>
            <CardDescription>
              Le turnover, les sorties datées, les retours et les suspensions sont valorisés au coût moyen par ETP du mois (photo de départ, leviers appliqués).
              Chaque hypothèse d&apos;arrivée est valorisée au coût moyen de son profil, par repli : même cost center et même profil, puis même dépôt, puis toute l&apos;entreprise.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Coût moyen par ETP des mois projetés</p>
              <div className="grid grid-cols-3 gap-2 text-xs sm:grid-cols-6 lg:grid-cols-12">
                {valorisation.mois.filter((m) => m.annee === selectedYear).map((m) => (
                  <div key={`${m.annee}-${m.mois}`} className="rounded-md border px-2 py-1">
                    <div className="text-muted-foreground">{FRENCH_MONTHS_SHORT[m.mois]}</div>
                    <div className="font-medium">{formatEuros(m.coutEtp)}</div>
                    <div className="text-muted-foreground">coef {m.coefficient.toLocaleString("fr-FR", { maximumFractionDigits: 3 })}{m.primes > 0 ? ` · primes ${formatEuros(m.primes)}` : ""}</div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Leviers de coût actifs ({leviers.length})</p>
              {leviers.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucun levier sur les scénarios sélectionnés : les salaires sont reconduits.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {leviers.map((l) => (
                    <li key={l.id}>
                      <span className="font-medium">{LIBELLES_LEVIER[l.type]}</span> — {l.centre_cout ?? "Global"} — dès {MONTH_LABELS[l.mois_effet]} {l.annee_effet} — {l.valeur.toLocaleString("fr-FR")} {unite(l.mode)}
                      {l.libelle ? <span className="text-muted-foreground"> · {l.libelle}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hypothèses valorisées ({valorisation.sources.length})</p>
              {valorisation.sources.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune hypothèse d&apos;arrivée ni de fin de CDD sur la période.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {valorisation.sources.map((src, i) => (
                    <li key={i}>
                      {src.sens === "arrivee" ? "Arrivée" : "Fin de CDD"} {MONTH_LABELS[src.mois.mois]} {src.mois.annee} — {src.libelle} — {formatEuros(src.cout.coutEtp)} par ETP
                      <span className="text-muted-foreground"> ({LIBELLES_REPLI[src.cout.niveau]}, {src.cout.n} salarié{src.cout.n > 1 ? "s" : ""} comparable{src.cout.n > 1 ? "s" : ""})</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {duMois.realise.mesure && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Paie réalisée — {moisLabel}</CardTitle>
            <CardDescription>
              {duMois.realise.n.toLocaleString("fr-FR")} lignes de {duMois.realise.source === "lignes" ? "la Liste des salaires" : "statistiques salariales"}{filtres.actifs ? " du périmètre" : ""}.
              {duMois.realise.source === "lignes"
                ? " Coût employeur = celui de la paie (total brut + charges patronales − avantages en nature)."
                : duMois.realise.employeurMesure
                  ? " Coût employeur = total brut + charges patronales, lues dans le fichier."
                  : " Le fichier importé ne porte pas les charges patronales : le coût employeur est estimé (brut × coefficient)."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              {([
                { libelle: "Brut base", valeur: duMois.realise.brutBase },
                { libelle: "Suppléments", valeur: duMois.realise.supplements, detail: detailsPaie?.supplements },
                { libelle: "Total brut", valeur: duMois.realise.brut },
                // Colonnes propres aux Statistiques rapides, absentes de la Liste des salaires
                ...(duMois.realise.source === "lignes"
                  ? []
                  : [{ libelle: "Cotisations totales (Total SECU)", valeur: duMois.realise.cotisationsTotales }]),
                { libelle: "CM patronale", valeur: duMois.realise.charges.cm, detail: detailsPaie?.cm },
                { libelle: "CP patronale", valeur: duMois.realise.charges.cp },
                { libelle: "Assurance accident", valeur: duMois.realise.charges.accident },
                ...(duMois.realise.source === "lignes" ? [] : [{ libelle: "Allocation familiale", valeur: duMois.realise.charges.allocation }]),
                { libelle: "Santé au travail", valeur: duMois.realise.charges.sante },
                { libelle: "Mutualité", valeur: duMois.realise.charges.mutualite },
                { libelle: "Autres cotisations patronales", valeur: duMois.realise.charges.autres },
                { libelle: "Charges patronales", valeur: duMois.realise.chargesPatronales, detail: detailsPaie?.charges },
                ...(duMois.realise.source === "lignes"
                  ? [
                    { libelle: "Avantages en nature (déduits)", valeur: duMois.realise.avantagesNature, detail: detailsPaie?.avantages },
                    { libelle: `Soldes de sortie (${duMois.realise.nonPeriodique.n} ligne${duMois.realise.nonPeriodique.n > 1 ? "s" : ""} non périodique${duMois.realise.nonPeriodique.n > 1 ? "s" : ""})`, valeur: duMois.realise.nonPeriodique.employeur, detail: detailsPaie?.soldes },
                  ]
                  : []),
              ] as { libelle: string; valeur: number; detail?: DetailCase | null }[]).map((c) => (
                <PaieCase key={c.libelle} libelle={c.libelle} valeur={c.valeur} detail={c.detail ?? null} />
              ))}
              <PaieCase
                grande
                accent
                libelle={`Coût employeur réalisé${duMois.realise.employeurMesure ? "" : " (estimé)"}`}
                valeur={stats.realise ?? 0}
                note={duMois.realise.employeurMesure && duMois.realise.brut > 0
                  ? `Coefficient réel du mois : ${(duMois.realise.employeur / duMois.realise.brut).toLocaleString("fr-FR", { maximumFractionDigits: 3 })}${duMois.realise.nonPeriodique.n > 0 ? ` · hors soldes de sortie : ${formatEuros(duMois.realise.employeur - duMois.realise.nonPeriodique.employeur)}` : ""}`
                  : undefined}
              />
              {stats.paye != null && stats.realise != null && (
                <PaieCase
                  grande
                  signe
                  libelle="Écart réalisé − payé contractuel"
                  valeur={stats.realise - stats.paye}
                  note={detailsPaie?.ecart ? "cliquer pour la réconciliation" : "suppléments, heures supplémentaires, prorata des entrées et sorties, régularisations"}
                  detail={detailsPaie?.ecart ?? null}
                />
              )}
            </div>
            {coefParCc.size > 0 && (
              <div className="mt-4">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Coefficient de charges par cost center (paie)</p>
                <div className="flex flex-wrap gap-2 text-xs">
                  {[...coefParCc.entries()].sort((a, b) => b[1].brut - a[1].brut).map(([cc, c]) => (
                    <span key={cc} className="rounded-md border px-2 py-1">{cc} : <span className="font-medium">{c.coef.toLocaleString("fr-FR", { maximumFractionDigits: 3 })}</span> <span className="text-muted-foreground">({c.n})</span></span>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {(paieParMois.length > 0 || paieDuMois) && (
        <PaieDecomposition
          moisLabel={moisLabel}
          parMois={paieParMois}
          duMois={paieDuMois}
          natures={naturesDuMois}
          parDepot={paieParDepot}
          parFonction={paieParFonction}
          perimetreFiltre={filtres.actifs}
        />
      )}

      {!aucunSalaire && lignesCostCenter.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Coût employeur par cost center — {moisLabel}</CardTitle>
            <CardDescription>
              Salariés sous contrat en fin de mois. Coût = brut plein temps × (1 + compléments récurrents{complements ? `, ${(complements.global.taux * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} % ou le taux du cost center` : ""}) × taux d&apos;occupation × coefficient de charges ({coefficient.coef.toLocaleString("fr-FR", { maximumFractionDigits: 3 })} par défaut, ou celui du cost center lu dans la paie) ; un salarié sans brut est compté au coût moyen par ETP du périmètre.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Cost center</TableHead>
                  <TableHead className="text-xs text-right">Salariés</TableHead>
                  <TableHead className="text-xs text-right">ETP</TableHead>
                  <TableHead className="text-xs text-right">Brut plein temps moyen</TableHead>
                  <TableHead className="text-xs text-right">Coût par ETP</TableHead>
                  <TableHead className="text-xs text-right">Coût sous contrat</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lignesCostCenter.map((l) => (
                  <TableRow key={l.cc}>
                    <TableCell className="text-sm font-medium">{l.cc}</TableCell>
                    <TableCell className="text-sm text-right">{l.n.toLocaleString("fr-FR")}{l.avecBrut < l.n ? <span className="ml-1 text-xs text-amber-600">({l.n - l.avecBrut} sans brut)</span> : null}</TableCell>
                    <TableCell className="text-sm text-right">{l.etp.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}</TableCell>
                    <TableCell className="text-sm text-right">{l.brutMoyen != null ? formatEuros(l.brutMoyen) : "—"}</TableCell>
                    <TableCell className="text-sm text-right">{l.coutEtp != null ? formatEuros(l.coutEtp) : "—"}</TableCell>
                    <TableCell className="text-sm text-right font-medium">{formatEuros(l.cout)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
