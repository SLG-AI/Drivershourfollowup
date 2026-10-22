/**
 * Outils Scénarios et besoins cibles de l'analyste IA : projection d'un
 * scénario de prévision (moteur `projeterScenarios`, valorisation
 * `valoriserProjection`, comme le tableau de bord et la page Coûts) et écart
 * entre l'effectif et un scénario de besoins cibles daté.
 *
 * Les hypothèses d'un scénario valent pour toute l'entreprise : la
 * projection n'est donc PAS ventilée par dépôt (on appliquerait des
 * hypothèses globales à un dépôt). Par dépôt, l'écart à la cible ne se
 * mesure que sur un mois réel.
 */

import type { HeadcountDataPoint } from "@/components/workforce/headcount-evolution-chart";
import { SEUIL_ANONYMAT, regrouperPetitsGroupes } from "@/lib/utils/wp-anonymisation";
import { lastDayOfMonth } from "@/lib/utils/wp-calculations";
import { construireSourceSalaires, type SalarieCout } from "@/lib/utils/wp-couts";
import { valoriserProjection } from "@/lib/utils/wp-couts-scenario";
import { estActifLe } from "@/lib/utils/wp-effectif-moyen";
import type { LevierCout } from "@/lib/utils/wp-leviers-cout";
import { projeterScenarios } from "@/lib/utils/wp-projection-scenarios";
import type { DonneesAnalyse } from "./donnees";
import type { DonneesScenarios } from "./donnees-workforce";
import { contexteCouts } from "./outils-couts";
import { contexteAnnee, type PhotoWf } from "./outils-workforce";

const MOIS_EN = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const r1 = (x: number) => Math.round(x * 10) / 10;
const r1n = (x: number | null | undefined) => (x == null ? null : r1(x));
const eur = (x: number | null | undefined) => (x == null ? null : Math.round(x));
const libelleMois = (mois: number, annee: number) => `${MOIS_EN[mois]} ${annee}`;
const nomDepot = (d: string) => d.replace(/^Depots? - /i, "") || "Not in roster";

function choisirScenario(s: DonneesScenarios, id?: string) {
  if (id) return s.scenarios.find((x) => x.id === id) ?? null;
  return s.scenarios.find((x) => x.is_default) ?? [...s.scenarios].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0] ?? null;
}

const listeScenarios = (s: DonneesScenarios) => s.scenarios.map((x) => ({ id: x.id, name: x.name, default: x.is_default }));

/** Projection d'UN scénario sur une année, avec son journal mensuel et, si les salaires existent, sa valorisation. */
async function projeter(d: DonneesAnalyse, annee: number, scenarioId: string, maintenant: Date) {
  const [eff, co, sc] = await Promise.all([d.effectifs(), d.couts(), d.scenarios()]);
  const k = contexteCouts(d, eff, co, annee, "all", maintenant);
  const c = k.c;
  // Le moteur MUTE la courbe (scenario_apres_conges) : il travaille sur une copie
  const headcountData = structuredClone(c.courbe.headcountData) as HeadcountDataPoint[];
  const allEmployees = c.photoAffichee;
  const projection = projeterScenarios({
    scenarioOptions: sc.scenarios.map((s) => ({ id: s.id, name: s.name })),
    selectedScenarioIds: [scenarioId],
    turnoverSrcId: null,
    absSrcId: null,
    leaveSrcId: null,
    rows: sc.rows,
    selectedYear: annee,
    selectedMonth: c.moisAffiche,
    allEmployees,
    getActiveEmployeesAt: (date: string) => allEmployees.filter((e) => estActifLe(e, date)),
    etapesProjection: c.courbe.etapesProjection,
    departProjection: c.courbe.departProjection,
    lastKnownCnsRate: c.courbe.tauxRepris.cns?.taux ?? null,
    lastKnownInjRate: c.courbe.tauxRepris.inj?.taux ?? null,
    lastKnownMctRate: c.courbe.tauxRepris.mct?.taux ?? null,
    headcountData,
  });

  // Valorisation : même photo de départ et mêmes leviers que la page Coûts
  let valorisation: ReturnType<typeof valoriserProjection> | null = null;
  if (projection.journalCombine?.length && !k.aucunSalaire) {
    const leviers: LevierCout[] = sc.leviers.filter((r) => r.scenario_id === scenarioId).map((r) => ({
      id: String(r.id), scenario_id: String(r.scenario_id), type: r.type as LevierCout["type"], centre_cout: (r.centre_cout as string) || null,
      annee_effet: Number(r.annee_effet), mois_effet: Number(r.mois_effet), valeur: Number(r.valeur), mode: r.mode as LevierCout["mode"], libelle: (r.libelle as string) || null,
    }));
    const lastRealIdx = c.courbe.headcountData.findIndex((p) => p.is_projection) - 1;
    const photoDepart = (lastRealIdx >= 0
      ? c.photos.photoDuMois(lastRealIdx + 1).filter((e) => estActifLe(e, lastDayOfMonth(annee, lastRealIdx + 1)))
      : c.photos.photoDuMoisDe(maintenant.getMonth() + 1, maintenant.getFullYear()).filter((e) => estActifLe(e, lastDayOfMonth(maintenant.getFullYear(), maintenant.getMonth() + 1)))) as (PhotoWf & SalarieCout)[];
    valorisation = valoriserProjection(projection.journalCombine, {
      photoDepart,
      source: construireSourceSalaires(photoDepart, k.photoReference),
      populationReference: k.photoReference ?? [],
      coefBase: k.coefficient.coef,
      leviers,
      premierMoisProjete: c.courbe.etapesProjection[0] ?? { mois: c.moisAffiche, annee },
      coutEtpDefaut: k.courbeCouts[c.moisAffiche - 1]?.couts.coutMoyenEtp ?? 0,
      complements: k.complements,
    });
  }
  return { c, projection, headcountData, valorisation, courbeCouts: k.courbeCouts };
}

export async function projectionScenario(d: DonneesAnalyse, p: { year: number; scenario_id?: string }, maintenant = new Date()) {
  const sc = await d.scenarios();
  const scenario = choisirScenario(sc, p.scenario_id);
  if (!scenario) return { error: p.scenario_id ? `Unknown scenario ${p.scenario_id}.` : "No forecast scenario exists.", scenarios: listeScenarios(sc) };
  const { c, projection, headcountData, valorisation, courbeCouts } = await projeter(d, p.year, scenario.id, maintenant);
  const journal = (projection.journalCombine ?? []).filter((j) => j.annee === p.year);
  if (journal.length === 0) {
    return { error: `${p.year} has no month left to project (projection starts after the current month).`, scenarios: listeScenarios(sc) };
  }
  const coutDe = (mois: number) => valorisation?.mois.find((m) => m.annee === p.year && m.mois === mois);
  // Après congés : la projection combinée (celle que les écrans tracent), pas la courbe mutée
  const combine = projection.scenarioProjections.find((x) => x.scenario_id === "__combined__");
  const apresConges = (mois: number) => combine?.months.find((m) => m.month_index === mois)?.scenario_apres_conges;
  return {
    year: p.year,
    scenario: { id: scenario.id, name: scenario.name, default: scenario.is_default },
    other_scenarios: listeScenarios(sc).filter((s) => s.id !== scenario.id),
    definition:
      "Projection of the selected forecast scenario from the last actual month, company-wide: each month, under contract = previous − max(planned departures, known exits) − turnover − ends of fixed-term contracts + planned hires + known hires + returns; after suspensions = under contract − suspensions; then the last known CNS sick-leave rate and the scenario absence rate (MCT) are applied; holidays from the scenario leave rates. Costs value each month with the latest salaries and the scenario cost levers.",
    starting_point: { month: libelleMois(c.moisAffiche, p.year), under_contract_fte: r1(c.courbe.departProjection.brut), after_suspensions_fte: r1(c.courbe.departProjection.net) },
    by_month: journal.map((j) => {
      const cout = coutDe(j.mois);
      return {
        month: libelleMois(j.mois, j.annee),
        under_contract_fte: r1(j.scenario_brut),
        after_suspensions_fte: r1(j.scenario_net),
        after_cns_sick_leave_fte: r1(j.scenario_reel),
        available_fte: r1(j.scenario_apres_mct),
        available_after_leave_fte: r1n(apresConges(j.mois)),
        drivers_of_change_fte: {
          turnover_losses: r1(j.turnoverLosses),
          departures: r1(j.departsRetenus),
          ends_of_fixed_term_contracts: r1(j.cddDepartures),
          planned_hires: r1(j.arrivalsEtp),
          known_hires: r1(j.dataArrivals),
          returns_from_suspension: r1(j.retours),
          suspensions_in_force: r1(j.tempExitsEtp),
        },
        rates_pct: { cns_sick_leave: r1(j.cnsRate), short_sick_mct: r1(j.absRate), unjustified: r1n(j.injRate) },
        projected_cost_under_contract_eur: cout ? eur(cout.scenario_brut) : null,
        projected_cost_per_fte_eur: cout ? eur(cout.coutEtp) : null,
      };
    }),
    without_scenario_for_comparison: journal.map((j) => ({ month: libelleMois(j.mois, j.annee), under_contract_fte: headcountData[j.mois - 1]?.effectif_brut ?? null, cost_under_contract_eur: eur(courbeCouts[j.mois - 1]?.point.effectif_brut) })),
    notes: [
      "Scenario assumptions apply to the whole company: the projection is not split by depot.",
      valorisation ? "Costs use the latest known salaries and the scenario cost levers (raises, minimum wage, charges coefficient)." : "No salary data: the projection is not valued in euros.",
    ],
  };
}

export async function ecartALaCible(d: DonneesAnalyse, p: { year: number; target_scenario_id?: string; projection_scenario_id?: string }, maintenant = new Date()) {
  const sc = await d.scenarios();
  const ciblesDeLAnnee = sc.cibles.filter((t) => t.annee === p.year);
  const cible = p.target_scenario_id
    ? sc.cibles.find((t) => t.id === p.target_scenario_id) ?? null
    : [...ciblesDeLAnnee].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0] ?? null;
  const historique = sc.ciblesHistoriques.length
    ? { total_target_headcount: sc.ciblesHistoriques.reduce((s, t) => s + t.target_headcount, 0), note: "Legacy single target (no month, no year), compared on the dashboard to the FTE after suspensions." }
    : null;
  if (!cible) {
    return {
      error: `No target scenario for ${p.year}.`,
      target_scenarios: sc.cibles.map((t) => ({ id: t.id, name: t.name, year: t.annee })),
      legacy_target: historique,
    };
  }
  const valeurs = sc.valeursCibles.filter((v) => v.scenario_id === cible.id);
  const scenario = p.projection_scenario_id ? choisirScenario(sc, p.projection_scenario_id) : choisirScenario(sc);
  const eff = await d.effectifs();
  const c = contexteAnnee(d, eff, cible.annee, "all", maintenant);
  const projete = scenario ? await projeter(d, cible.annee, scenario.id, maintenant) : null;
  const netProjete = new Map((projete?.projection.journalCombine ?? []).filter((j) => j.annee === cible.annee).map((j) => [j.mois, j.scenario_net]));

  /** ETP après suspensions des seuls dépôts qui ont une cible ce mois-là (mois réel : photo du mois). */
  const etpDesDepots = (m: number, depots: Set<string>) => {
    const photo = c.photos.photoDuMois(m).filter((e) => depots.has(e.description_service || "") && estActifLe(e, lastDayOfMonth(cible.annee, m)));
    return c.paliersDe(photo, m, true).apresSuspension;
  };
  const parMois = Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
    const duMois = valeurs.filter((v) => v.mois === m && v.target_etp > 0);
    const cibleMois = duMois.reduce((s, v) => s + v.target_etp, 0);
    const depots = new Set(duMois.map((v) => v.depot));
    const pt = c.courbe.headcountData[m - 1];
    const base = { month: libelleMois(m, cible.annee), target_fte: cibleMois > 0 ? r1(cibleMois) : null, depots_with_target: depots.size };
    if (cibleMois === 0) return { ...base, fte_after_suspensions: null, source: "no target this month", gap_fte: null, fte_to_hire_to_reach_target: null };
    const reel = !pt.is_projection && !netProjete.has(m);
    let effectif: number | null;
    let source: string;
    if (reel) {
      effectif = etpDesDepots(m, depots);
      source = "actual (depots with a target)";
    } else {
      // Projection = toute l'entreprise : utilisable seulement si la cible couvre (presque) toute l'entreprise
      const dernier = c.moisAffiche;
      const part = c.courbe.headcountData[dernier - 1].effectif_net > 0 ? etpDesDepots(dernier, depots) / c.courbe.headcountData[dernier - 1].effectif_net : 0;
      if (part >= 0.98) {
        effectif = netProjete.get(m) ?? pt.effectif_net;
        source = netProjete.has(m) ? "scenario projection (company-wide)" : "projection without scenario (company-wide)";
      } else {
        effectif = null;
        source = `not available: projections are company-wide and this target covers depots holding ${Math.round(part * 100)}% of FTE`;
      }
    }
    const ecart = effectif == null ? null : effectif - cibleMois;
    return {
      ...base,
      fte_after_suspensions: r1n(effectif),
      source,
      gap_fte: r1n(ecart),
      fte_to_hire_to_reach_target: ecart == null ? null : r1(Math.max(0, -ecart)),
    };
  });

  // Par dépôt : seulement sur le dernier mois réel (mesuré), cible du même mois
  const moisReel = c.courbe.headcountData.findIndex((pt) => pt.is_projection);
  const dernierReel = moisReel === -1 ? 12 : moisReel;
  let parDepot: unknown = null;
  if (dernierReel >= 1) {
    const photo = c.photos.photoDuMois(dernierReel).filter((e) => estActifLe(e, lastDayOfMonth(cible.annee, dernierReel)));
    const depots = new Set([...photo.map((e) => e.description_service || ""), ...valeurs.filter((v) => v.mois === dernierReel).map((v) => v.depot)]);
    const groupes = regrouperPetitsGroupes(
      [...depots].map((depot) => {
        const population = photo.filter((e) => (e.description_service || "") === depot);
        return { depots: [depot], population, cible: valeurs.filter((v) => v.mois === dernierReel && v.depot === depot).reduce((s, v) => s + v.target_etp, 0) };
      }),
      (g) => g.population.length,
      (petits) => ({ depots: petits.flatMap((g) => g.depots), population: petits.flatMap((g) => g.population), cible: petits.reduce((s, g) => s + g.cible, 0) })
    );
    parDepot = {
      month: libelleMois(dernierReel, cible.annee),
      by_depot: groupes
        .map((g) => {
          const net = c.paliersDe(g.population, dernierReel, true).apresSuspension;
          return {
            depot: g.depots.length > 1 ? `Others (${g.depots.length} depots)` : nomDepot(g.depots[0]),
            target_fte: g.cible > 0 ? r1(g.cible) : null,
            fte_after_suspensions: r1(net),
            gap_fte: g.cible > 0 ? r1(net - g.cible) : null,
          };
        })
        .sort((a, b) => (a.gap_fte ?? 0) - (b.gap_fte ?? 0)),
    };
  }

  return {
    year: cible.annee,
    target_scenario: { id: cible.id, name: cible.name },
    other_target_scenarios: sc.cibles.filter((t) => t.id !== cible.id).map((t) => ({ id: t.id, name: t.name, year: t.annee })),
    projection_scenario: scenario ? { id: scenario.id, name: scenario.name } : null,
    definition: "Target FTE (target scenario, sum of its depots per month) vs FTE after contract suspensions of the SAME depots — the measure the dashboard compares to its target. Actual months use the roster; future months use the projection scenario (or, without one, the roster carried forward), only when the target covers the whole company since projections are not split by depot. gap = FTE − target (negative = shortfall); FTE to hire = the shortfall, since a new hire adds one FTE under contract and after suspensions.",
    by_month: parMois,
    latest_actual_month_by_depot: parDepot,
    legacy_target: historique,
    excluded: `Depots with fewer than ${SEUIL_ANONYMAT} people merged into 'Others'. Projections are company-wide only.`,
  };
}
