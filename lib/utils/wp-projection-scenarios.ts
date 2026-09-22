/**
 * Projection des scénarios sur la courbe des effectifs, en ETP.
 *
 * POURQUOI ICI. Ce calcul vivait en ligne dans le tableau de bord, refermé sur
 * ses variables locales, à la suite de la courbe (wp-courbe-effectifs.ts). Il
 * est extrait tel quel, sans en changer une règle, pour deux raisons : le
 * tester hors de la page, et lui faire émettre un JOURNAL mensuel — ce que
 * chaque mois ajoute ou retranche — que la boucle calculait déjà sans le
 * garder. Le tableau de bord fait toujours les requêtes (mêmes tables, même
 * `Promise.all`) et passe les lignes brutes ; il relit ce qu'il lisait avant.
 *
 * RÈGLES, inchangées :
 *  - une projection par scénario (courbes de la carte « scénarios »), puis
 *    une projection COMBINÉE des scénarios sélectionnés : hypothèses
 *    fusionnées, taux de turnover / d'absentéisme / de congés pris chacun
 *    dans UN scénario source (`turnoverSrcId`, `absSrcId`, `leaveSrcId`,
 *    à défaut le premier sélectionné) ;
 *  - un taux par centre de coût est pondéré par l'ETP des actifs du mois
 *    (hors suspensions) ; sans ligne par centre, le taux global du mois, à
 *    défaut celui du scénario (turnover) ou 5 % (absentéisme) ou 0 (congés) ;
 *  - chaque mois : sous contrat = précédent − max(départs d'hypothèse,
 *    sorties datées) − turnover − fins de CDD + arrivées (hypothèses + datées)
 *    + retours ; net = sous contrat − suspensions (données + hypothèses
 *    cumulées) ; réel = net − dernier taux CNS connu ; après MCT = réel −
 *    taux d'absentéisme du scénario ;
 *  - une année future s'enchaîne aux mois restants de l'année en cours
 *    (`etapesProjection`) : ces mois se calculent mais ne se tracent pas ;
 *  - le pool de congés (net moyen annuel × 240 h / 173 h) se répartit par le
 *    taux mensuel de congés et vient MUTER `headcountData` (scenario_apres_conges),
 *    comme avant.
 *
 * JOURNAL. `journalCombine` garde, pour chaque mois projeté de la projection
 * combinée (y compris ceux de l'année en cours enchaînés), les composantes du
 * calcul telles que la boucle les produit. Il est purement additif.
 */

import type { HeadcountDataPoint, ScenarioOption, ScenarioProjectionData } from "@/components/workforce/headcount-evolution-chart";
import type { ArrivalHypothesisItem, DepartureHypothesisItem, RateByMonthCC, TempExitHypothesisItem } from "@/components/workforce/scenario-hypotheses-card";
import {
  arriveesDuMois,
  finsDeCddDuMois,
  getArrivalsForMonth,
  getCddDeparturesForMonth,
  getTempExitDeparturesForMonth,
  getTempExitReturnsForMonth,
  isTempExitAt,
  lastDayOfMonth,
  type ArrivalHypothesis,
  type TempExitHypothesis,
} from "./wp-calculations";
import type { MoisAnnee } from "./wp-courbe-effectifs";
import { etpDe, type SalariePaliers } from "./wp-paliers";

/** Ligne brute d'une table `wp_scenario_*` (résultat de fetchAll). */
export type Row = Record<string, unknown>;

/** Salarié tel que la page le manipule : paliers + centre de coût (pondération des taux). */
export type SalarieProjection = SalariePaliers & { centre_cout?: string | null };

export interface EntreesProjection {
  scenarioOptions: ScenarioOption[];
  selectedScenarioIds: string[];
  turnoverSrcId: string | null;
  absSrcId: string | null;
  leaveSrcId: string | null;
  /** Lignes brutes des 7 requêtes, toutes scénarios confondus. */
  rows: {
    params: Row[];
    turnoverParams: Row[];
    leaveParams: Row[];
    departures: Row[];
    arrivals: Row[];
    tempExits: Row[];
    details: Row[];
  };
  selectedYear: number;
  selectedMonth: number;
  /** Photo affichée, filtrée et reclassifiée. */
  allEmployees: SalarieProjection[];
  /** Actifs de la photo affichée à une date (voir actifsParmi dans la page). */
  getActiveEmployeesAt: (date: string) => SalarieProjection[];
  /** Mois à projeter, dans l'ordre (voir wp-courbe-effectifs). */
  etapesProjection: MoisAnnee[];
  /** Point de départ des projections. */
  departProjection: { brut: number; net: number };
  /** Dernier taux CNS connu (%), null si aucun. */
  lastKnownCnsRate: number | null;
  /** Courbe de l'année affichée : MUTÉE pour `scenario_apres_conges`, comme avant. */
  headcountData: HeadcountDataPoint[];
}

/** Un mois de la projection combinée, composantes telles que la boucle les calcule. */
export interface JournalMoisProjection {
  annee: number;
  mois: number;
  /** Sous contrat en entrée du mois. */
  runningBrutAvant: number;
  turnoverLosses: number;
  /** Départs d'hypothèse (ETP), sorties datées (ETP) et le retenu : le max des deux. */
  departsHyp: number;
  dataExits: number;
  departsRetenus: number;
  dataExitsCodes: string[];
  dataArrivalsCodes: string[];
  arriveesHyp: ArrivalHypothesis[];
  /** Somme des `nb_personnes` des arrivées d'hypothèse (comme la boucle). */
  arrivalsEtp: number;
  dataArrivals: number;
  finsCddHyp: ArrivalHypothesis[];
  cddDepartures: number;
  retours: number;
  /** Suspensions du mois : données + hypothèses cumulées. */
  tempExitsEtp: number;
  cnsRate: number;
  absRate: number;
  /** ETP de congés du mois (pool réparti), seulement pour l'année affichée. */
  leaveFte?: number;
  scenario_brut: number;
  scenario_net: number;
  scenario_reel: number;
  scenario_apres_mct: number;
}

export interface ScenarioKpiOverride {
  effectif_brut: number;
  effectif_net: number;
  sorties_temporaires: number;
  taux_absenteisme: number;
  taux_mct: number;
}

export interface SortieProjection {
  scenarioProjections: ScenarioProjectionData[];
  /** Journal de la projection combinée, null sans scénario sélectionné. */
  journalCombine: JournalMoisProjection[] | null;
  /** Hypothèses compilées pour la carte d'hypothèses. */
  hypotheses: {
    arrivals: ArrivalHypothesisItem[];
    departures: DepartureHypothesisItem[];
    tempExits: TempExitHypothesisItem[];
    turnoverRates: RateByMonthCC[];
    absRates: RateByMonthCC[];
    leaveRates: RateByMonthCC[];
    turnoverSrcName: string | null;
    absSrcName: string | null;
    leaveSrcName: string | null;
  };
  /** KPI du mois affiché remplacés par le scénario combiné. */
  scenarioKpiOverride: ScenarioKpiOverride | null;
  scenarioTurnoverLossesTotal: number;
  /** Pertes par turnover du scénario combiné sur le MOIS affiché (KPI mensuel). */
  scenarioTurnoverLossesMoisAffiche: number;
}

export function projeterScenarios(e: EntreesProjection): SortieProjection {
  const {
    scenarioOptions, selectedScenarioIds, turnoverSrcId, absSrcId, leaveSrcId,
    selectedYear, selectedMonth, allEmployees, getActiveEmployeesAt,
    etapesProjection, departProjection, lastKnownCnsRate, headcountData,
  } = e;
  const getEtp = (s: SalarieProjection) => etpDe(s);

  const scenarioProjections: ScenarioProjectionData[] = [];
  let journalCombine: JournalMoisProjection[] | null = null;
  let hypArrivals: ArrivalHypothesisItem[] = [];
  let hypDepartures: DepartureHypothesisItem[] = [];
  let hypTempExits: TempExitHypothesisItem[] = [];
  let hypTurnoverRates: RateByMonthCC[] = [];
  let hypAbsRates: RateByMonthCC[] = [];
  let hypLeaveRates: RateByMonthCC[] = [];
  let hypTurnoverSrcName: string | null = null;
  let hypAbsSrcName: string | null = null;
  let hypLeaveSrcName: string | null = null;
  // Scenario KPI overrides for selected month
  let scenarioKpiOverride: ScenarioKpiOverride | null = null;
  let scenarioTurnoverLossesTotal = 0;
  // Pertes par turnover du scénario combiné sur le MOIS affiché (KPI mensuel)
  let scenarioTurnoverLossesMoisAffiche = 0;

  if (scenarioOptions.length > 0) {
    const scenarioParamsAll = e.rows.params;
    const scenarioTurnoverParamsAll = e.rows.turnoverParams;
    const scenarioLeaveParamsAll = e.rows.leaveParams;
    const scenarioDeparturesAll = e.rows.departures;
    const scenarioArrivalsAll = e.rows.arrivals;
    const scenarioTempExitsAll = e.rows.tempExits;
    const scenarioDetailsAll = e.rows.details;

    for (const sc of scenarioOptions) {
      const scParams = scenarioParamsAll.filter((p) => p.scenario_id === sc.id);
      const scDepartures = scenarioDeparturesAll.filter((d) => d.scenario_id === sc.id);
      const scArrivals = scenarioArrivalsAll.filter((a) => a.scenario_id === sc.id) as unknown as ArrivalHypothesis[];
      const scTempExits = scenarioTempExitsAll
        .filter((t) => t.scenario_id === sc.id)
        .map((t) => ({
          id: t.id as string,
          scenario_id: t.scenario_id as string,
          nb_personnes: Number(t.nb_personnes),
          taux_occupation: Number(t.taux_occupation),
          fonction: (t.fonction as string) || null,
          centre_cout: (t.centre_cout as string) || null,
          depot: (t.depot as string) || null,
          vehicle_type: (t.vehicle_type as "BUS" | "CAM") || null,
          motif: (t.motif as string) || "Congé parental",
          departure_day: Number(t.departure_day) || 1,
          departure_month: Number(t.departure_month),
          departure_year: Number(t.departure_year),
          return_day: t.return_day ? Number(t.return_day) : null,
          return_month: t.return_month ? Number(t.return_month) : null,
          return_year: t.return_year ? Number(t.return_year) : null,
        })) as TempExitHypothesis[];
      const scDetail = scenarioDetailsAll.find((s) => s.id === sc.id);
      const turnoverRate = Number(scDetail?.projected_turnover_rate ?? 0);

      // Build per-month turnover rate: weighted average across cost centers
      const scTurnoverParams = scenarioTurnoverParamsAll.filter((p) => p.scenario_id === sc.id);
      const globalTurnoverByMonth = new Map<number, number>();
      const ccTurnoverByMonthCc = new Map<string, number>();
      scTurnoverParams.forEach((p) => {
        const mois = Number(p.mois);
        const rate = Number(p.projected_turnover_rate);
        if (!p.centre_cout) {
          globalTurnoverByMonth.set(mois, rate);
        } else {
          ccTurnoverByMonthCc.set(`${mois}:${p.centre_cout}`, rate);
        }
      });
      const turnoverRateByMonth = new Map<number, number>();
      for (let m = 1; m <= 12; m++) {
        const monthEnd = lastDayOfMonth(selectedYear, m);
        const activeAtM = getActiveEmployeesAt(monthEnd).filter((s) => !isTempExitAt(s, monthEnd));
        const totalEtp = activeAtM.reduce((sum, s) => sum + getEtp(s), 0);
        if (totalEtp > 0 && ccTurnoverByMonthCc.size > 0) {
          const weightedRate = activeAtM.reduce((sum, s) => {
            const ccKey = `${m}:${s.centre_cout}`;
            const rate = ccTurnoverByMonthCc.get(ccKey) ?? globalTurnoverByMonth.get(m) ?? turnoverRate;
            return sum + getEtp(s) * rate;
          }, 0);
          turnoverRateByMonth.set(m, weightedRate / totalEtp);
        } else {
          turnoverRateByMonth.set(m, globalTurnoverByMonth.get(m) ?? turnoverRate);
        }
      }

      // Build per-month absenteeism rate: weighted average across cost centers
      // Global rates (centre_cout IS NULL) as fallback
      const globalRateByMonth = new Map<number, number>();
      const ccRateByMonthCc = new Map<string, number>();
      scParams.forEach((p) => {
        const mois = Number(p.mois);
        const rate = Number(p.projected_absenteeism_rate);
        if (!p.centre_cout) {
          globalRateByMonth.set(mois, rate);
        } else {
          ccRateByMonthCc.set(`${mois}:${p.centre_cout}`, rate);
        }
      });
      // Compute weighted average rate per month using active employees
      const absRateByMonth = new Map<number, number>();
      for (let m = 1; m <= 12; m++) {
        const monthEnd = lastDayOfMonth(selectedYear, m);
        const activeAtM = getActiveEmployeesAt(monthEnd).filter((s) => !isTempExitAt(s, monthEnd));
        const totalEtp = activeAtM.reduce((sum, s) => sum + getEtp(s), 0);
        if (totalEtp > 0 && ccRateByMonthCc.size > 0) {
          const weightedRate = activeAtM.reduce((sum, s) => {
            const ccKey = `${m}:${s.centre_cout}`;
            const rate = ccRateByMonthCc.get(ccKey) ?? globalRateByMonth.get(m) ?? 5;
            return sum + getEtp(s) * rate;
          }, 0);
          absRateByMonth.set(m, weightedRate / totalEtp);
        } else {
          absRateByMonth.set(m, globalRateByMonth.get(m) ?? 5);
        }
      }

      // Build departure ETP by month (exclude temporary exits — they stay "sous contrat")
      // Clé « annee-mois » : la projection peut enchaîner plusieurs années
      const depCountByMonth = new Map<string, number>();
      scDepartures
        .filter((d) => !String(d.departure_type || "").startsWith("temp_exit"))
        .forEach((d) => {
          const cle = `${Number(d.departure_year)}-${Number(d.departure_month)}`;
          const nb = Number(d.nb_personnes) || 1;
          const taux = Number(d.taux_occupation) || 100;
          const etp = nb * taux / 100;
          depCountByMonth.set(cle, (depCountByMonth.get(cle) || 0) + etp);
        });

      // Return counts from temp exits
      const returnCountByMonth = new Map<string, number>();
      scDepartures
        .filter((d) => d.return_year && d.return_month)
        .forEach((d) => {
          const cle = `${Number(d.return_year)}-${Number(d.return_month)}`;
          returnCountByMonth.set(cle, (returnCountByMonth.get(cle) || 0) + 1);
        });

      // Find the last real month's values as starting point
      let runningBrut = departProjection.brut;
      let runningTempExitsEtp = departProjection.brut - departProjection.net;
      let cumulTempExitHyp = 0; // cumulative ETP from temp exit hypotheses

      const months: ScenarioProjectionData["months"] = [];

      for (const { annee, mois: m } of etapesProjection) {

        // Turnover losses (use per-month weighted rate)
        const effectiveTurnoverRate = turnoverRateByMonth.get(m) ?? turnoverRate;
        const monthlyTurnoverRate = effectiveTurnoverRate / 100 / 12;
        const turnoverLosses = Math.round(runningBrut * monthlyTurnoverRate * 10) / 10;

        // Known departures
        const knownDeps = depCountByMonth.get(`${annee}-${m}`) || 0;

        // Data-based departures in ETP (employees with date_sortie in this month)
        // Exclude temporary exits — they stay "sous contrat"
        // If date_sortie is the last day of its month, effective departure is next month
        const dataExits = allEmployees.filter((s) => {
          if (!s.date_sortie || s.est_sortie_temporaire) return false;
          const d = new Date(s.date_sortie);
          let depMonth = d.getMonth() + 1;
          let depYear = d.getFullYear();
          const ldm = lastDayOfMonth(depYear, depMonth);
          if (s.date_sortie === ldm) {
            depMonth += 1;
            if (depMonth > 12) { depMonth = 1; depYear += 1; }
          }
          return depMonth === m && depYear === annee;
        }).reduce((sum, s) => sum + getEtp(s), 0);

        // Arrivals from data (employees with date_entree in this month)
        const dataArrivals = allEmployees.filter((s) => {
          if (!s.date_entree) return false;
          const d = new Date(s.date_entree);
          return d.getMonth() + 1 === m && d.getFullYear() === annee;
        }).reduce((sum, s) => sum + getEtp(s), 0);

        // Arrivals from hypotheses
        const arrivals = getArrivalsForMonth(scArrivals, m, annee);
        // CDD auto-departures
        const cddDepartures = getCddDeparturesForMonth(scArrivals, m, annee);

        // Returns from temp exits
        const returns = returnCountByMonth.get(`${annee}-${m}`) || 0;

        const totalDepartures = Math.max(knownDeps, dataExits) + turnoverLosses + cddDepartures;
        const totalArrivals = arrivals + dataArrivals;

        runningBrut = Math.max(0, runningBrut - totalDepartures + totalArrivals + returns);

        // Calculate temp exits ETP directly from employee data for this month
        const monthEnd = lastDayOfMonth(annee, m);
        const activeAtMonth = getActiveEmployeesAt(monthEnd);
        const dataTempExitsEtp = activeAtMonth
          .filter((s) => isTempExitAt(s, monthEnd))
          .reduce((sum, s) => sum + getEtp(s), 0);

        // Add cumulative temp exit hypotheses from scenario
        const tempExitHypDepartures = getTempExitDeparturesForMonth(scTempExits, m, annee);
        const tempExitHypReturns = getTempExitReturnsForMonth(scTempExits, m, annee);
        cumulTempExitHyp = Math.max(0, cumulTempExitHyp + tempExitHypDepartures - tempExitHypReturns);
        runningTempExitsEtp = dataTempExitsEtp + cumulTempExitHyp;

        const scenarioNet = runningBrut - runningTempExitsEtp;

        // Réel projeté = net - dernier taux CNS connu
        const cnsRate = lastKnownCnsRate ?? 0;
        const scenarioCnsEtp = scenarioNet * (cnsRate / 100);
        const scenarioReel = scenarioNet - scenarioCnsEtp;

        // Le taux d'absentéisme du scénario impacte le MCT
        const absRate = absRateByMonth.get(m) ?? 5;
        const scenarioMctFte = scenarioNet * (absRate / 100);

        // Seuls les mois de l'année affichée sont rendus ; les mois antérieurs
        // (fin de l'année en cours) ne servent qu'à enchaîner la projection.
        if (annee !== selectedYear) continue;
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

    // ============================================================
    // Combined projection: merge selected scenarios
    // ============================================================
    if (selectedScenarioIds.length > 0) {
      const selectedScs = scenarioOptions.filter((s) => selectedScenarioIds.includes(s.id));
      if (selectedScs.length > 0) {
        // Merge hypotheses from all selected scenarios
        const combinedArrivals: ArrivalHypothesis[] = [];
        const combinedDepCountByMonth = new Map<string, number>();
        const combinedReturnCountByMonth = new Map<string, number>();
        const combinedTempExits: TempExitHypothesis[] = [];

        for (const sc of selectedScs) {
          const scArrivals = scenarioArrivalsAll.filter((a) => a.scenario_id === sc.id) as unknown as ArrivalHypothesis[];
          const scDepartures = scenarioDeparturesAll.filter((d) => d.scenario_id === sc.id);
          const scTempExits = scenarioTempExitsAll
            .filter((t) => t.scenario_id === sc.id)
            .map((t) => ({
              id: t.id as string,
              scenario_id: t.scenario_id as string,
              nb_personnes: Number(t.nb_personnes),
              taux_occupation: Number(t.taux_occupation),
              fonction: (t.fonction as string) || null,
              centre_cout: (t.centre_cout as string) || null,
              depot: (t.depot as string) || null,
              vehicle_type: (t.vehicle_type as "BUS" | "CAM") || null,
              motif: (t.motif as string) || "Congé parental",
              departure_day: Number(t.departure_day) || 1,
              departure_month: Number(t.departure_month),
              departure_year: Number(t.departure_year),
              return_day: t.return_day ? Number(t.return_day) : null,
              return_month: t.return_month ? Number(t.return_month) : null,
              return_year: t.return_year ? Number(t.return_year) : null,
            })) as TempExitHypothesis[];

          combinedArrivals.push(...scArrivals);
          combinedTempExits.push(...scTempExits);

          // Accumulate departures by month
          scDepartures
            .filter((d) => !String(d.departure_type || "").startsWith("temp_exit"))
            .forEach((d) => {
              const cle = `${Number(d.departure_year)}-${Number(d.departure_month)}`;
              const nb = Number(d.nb_personnes) || 1;
              const taux = Number(d.taux_occupation) || 100;
              const etp = nb * taux / 100;
              combinedDepCountByMonth.set(cle, (combinedDepCountByMonth.get(cle) || 0) + etp);
            });

          // Accumulate return counts
          scDepartures
            .filter((d) => d.return_year && d.return_month)
            .forEach((d) => {
              const cle = `${Number(d.return_year)}-${Number(d.return_month)}`;
              combinedReturnCountByMonth.set(cle, (combinedReturnCountByMonth.get(cle) || 0) + 1);
            });
        }

        // Select turnover rates from source scenario
        const turnoverSrcScId = turnoverSrcId && selectedScenarioIds.includes(turnoverSrcId)
          ? turnoverSrcId : selectedScenarioIds[0];
        const turnoverSrcParams = scenarioTurnoverParamsAll.filter((p) => p.scenario_id === turnoverSrcScId);
        const turnoverSrcDetail = scenarioDetailsAll.find((s) => s.id === turnoverSrcScId);
        const combinedTurnoverFallback = Number(turnoverSrcDetail?.projected_turnover_rate ?? 0);
        const combinedGlobalTurnoverByMonth = new Map<number, number>();
        const combinedCcTurnoverByMonthCc = new Map<string, number>();
        turnoverSrcParams.forEach((p) => {
          const mois = Number(p.mois);
          const rate = Number(p.projected_turnover_rate);
          if (!p.centre_cout) {
            combinedGlobalTurnoverByMonth.set(mois, rate);
          } else {
            combinedCcTurnoverByMonthCc.set(`${mois}:${p.centre_cout}`, rate);
          }
        });
        const combinedTurnoverRateByMonth = new Map<number, number>();
        for (let m = 1; m <= 12; m++) {
          const monthEnd = lastDayOfMonth(selectedYear, m);
          const activeAtM = getActiveEmployeesAt(monthEnd).filter((s) => !isTempExitAt(s, monthEnd));
          const totalEtp = activeAtM.reduce((sum, s) => sum + getEtp(s), 0);
          if (totalEtp > 0 && combinedCcTurnoverByMonthCc.size > 0) {
            const weightedRate = activeAtM.reduce((sum, s) => {
              const ccKey = `${m}:${s.centre_cout}`;
              const rate = combinedCcTurnoverByMonthCc.get(ccKey) ?? combinedGlobalTurnoverByMonth.get(m) ?? combinedTurnoverFallback;
              return sum + getEtp(s) * rate;
            }, 0);
            combinedTurnoverRateByMonth.set(m, weightedRate / totalEtp);
          } else {
            combinedTurnoverRateByMonth.set(m, combinedGlobalTurnoverByMonth.get(m) ?? combinedTurnoverFallback);
          }
        }

        // Select absenteeism rates from source scenario
        const absSrcScId = absSrcId && selectedScenarioIds.includes(absSrcId)
          ? absSrcId : selectedScenarioIds[0];
        const absSrcParams = scenarioParamsAll.filter((p) => p.scenario_id === absSrcScId);
        const combinedGlobalAbsRateByMonth = new Map<number, number>();
        const combinedCcAbsRateByMonthCc = new Map<string, number>();
        absSrcParams.forEach((p) => {
          const mois = Number(p.mois);
          const rate = Number(p.projected_absenteeism_rate);
          if (!p.centre_cout) {
            combinedGlobalAbsRateByMonth.set(mois, rate);
          } else {
            combinedCcAbsRateByMonthCc.set(`${mois}:${p.centre_cout}`, rate);
          }
        });
        const combinedAbsRateByMonth = new Map<number, number>();
        for (let m = 1; m <= 12; m++) {
          const monthEnd = lastDayOfMonth(selectedYear, m);
          const activeAtM = getActiveEmployeesAt(monthEnd).filter((s) => !isTempExitAt(s, monthEnd));
          const totalEtp = activeAtM.reduce((sum, s) => sum + getEtp(s), 0);
          if (totalEtp > 0 && combinedCcAbsRateByMonthCc.size > 0) {
            const weightedRate = activeAtM.reduce((sum, s) => {
              const ccKey = `${m}:${s.centre_cout}`;
              const rate = combinedCcAbsRateByMonthCc.get(ccKey) ?? combinedGlobalAbsRateByMonth.get(m) ?? 5;
              return sum + getEtp(s) * rate;
            }, 0);
            combinedAbsRateByMonth.set(m, weightedRate / totalEtp);
          } else {
            combinedAbsRateByMonth.set(m, combinedGlobalAbsRateByMonth.get(m) ?? 5);
          }
        }

        // Select leave rates from source scenario
        const leaveSrcScId = leaveSrcId && selectedScenarioIds.includes(leaveSrcId)
          ? leaveSrcId : selectedScenarioIds[0];
        const leaveSrcParams = scenarioLeaveParamsAll.filter((p) => p.scenario_id === leaveSrcScId);
        const combinedGlobalLeaveRateByMonth = new Map<number, number>();
        const combinedCcLeaveRateByMonthCc = new Map<string, number>();
        leaveSrcParams.forEach((p) => {
          const mois = Number(p.mois);
          const rate = Number(p.projected_leave_rate);
          if (!p.centre_cout) {
            combinedGlobalLeaveRateByMonth.set(mois, rate);
          } else {
            combinedCcLeaveRateByMonthCc.set(`${mois}:${p.centre_cout}`, rate);
          }
        });
        const combinedLeaveRateByMonth = new Map<number, number>();
        for (let m = 1; m <= 12; m++) {
          const monthEnd = lastDayOfMonth(selectedYear, m);
          const activeAtM = getActiveEmployeesAt(monthEnd).filter((s) => !isTempExitAt(s, monthEnd));
          const totalEtp = activeAtM.reduce((sum, s) => sum + getEtp(s), 0);
          if (totalEtp > 0 && combinedCcLeaveRateByMonthCc.size > 0) {
            const weightedRate = activeAtM.reduce((sum, s) => {
              const ccKey = `${m}:${s.centre_cout}`;
              const rate = combinedCcLeaveRateByMonthCc.get(ccKey) ?? combinedGlobalLeaveRateByMonth.get(m) ?? 0;
              return sum + getEtp(s) * rate;
            }, 0);
            combinedLeaveRateByMonth.set(m, weightedRate / totalEtp);
          } else {
            combinedLeaveRateByMonth.set(m, combinedGlobalLeaveRateByMonth.get(m) ?? 0);
          }
        }

        // Compile hypotheses for the card
        hypArrivals = combinedArrivals.map((a) => ({
          nb_personnes: a.nb_personnes,
          taux_occupation: a.taux_occupation,
          type_contrat: a.type_contrat,
          fonction: a.fonction,
          centre_cout: a.centre_cout,
          vehicle_type: a.vehicle_type,
          start_month: a.start_month,
          start_year: a.start_year,
          end_month: a.end_month,
          end_year: a.end_year,
        }));
        hypDepartures = selectedScs.flatMap((sc) =>
          scenarioDeparturesAll
            .filter((d) => d.scenario_id === sc.id && !d.is_from_data)
            .map((d) => ({
              nb_personnes: Number(d.nb_personnes) || 1,
              taux_occupation: Number(d.taux_occupation) || 100,
              departure_type: String(d.departure_type || ""),
              fonction: (d.fonction as string) || null,
              centre_cout: (d.centre_cout as string) || null,
              vehicle_type: (d.vehicle_type as "BUS" | "CAM") || null,
              departure_month: Number(d.departure_month),
              departure_year: Number(d.departure_year),
            }))
        );
        hypTempExits = combinedTempExits.map((t) => ({
          nb_personnes: t.nb_personnes,
          taux_occupation: t.taux_occupation,
          motif: t.motif,
          fonction: t.fonction,
          centre_cout: t.centre_cout,
          vehicle_type: t.vehicle_type,
          departure_month: t.departure_month,
          departure_year: t.departure_year,
          return_month: t.return_month,
          return_year: t.return_year,
        }));
        hypTurnoverRates = turnoverSrcParams.map((p) => ({
          mois: Number(p.mois),
          centre_cout: (p.centre_cout as string) || null,
          rate: Number(p.projected_turnover_rate),
        }));
        hypAbsRates = absSrcParams.map((p) => ({
          mois: Number(p.mois),
          centre_cout: (p.centre_cout as string) || null,
          rate: Number(p.projected_absenteeism_rate),
        }));
        hypLeaveRates = leaveSrcParams.map((p) => ({
          mois: Number(p.mois),
          centre_cout: (p.centre_cout as string) || null,
          rate: Number(p.projected_leave_rate),
        }));
        hypTurnoverSrcName = scenarioOptions.find((s) => s.id === turnoverSrcScId)?.name ?? null;
        hypAbsSrcName = scenarioOptions.find((s) => s.id === absSrcScId)?.name ?? null;
        hypLeaveSrcName = scenarioOptions.find((s) => s.id === leaveSrcScId)?.name ?? null;

        // Run the same projection loop with combined data
        let runningBrut = departProjection.brut;
        let cumulTempExitHyp = 0;

        const combinedMonths: ScenarioProjectionData["months"] = [];
        const journal: JournalMoisProjection[] = [];

        for (const { annee, mois: m } of etapesProjection) {
          const runningBrutAvant = runningBrut;

          const effectiveTurnoverRate = combinedTurnoverRateByMonth.get(m) ?? combinedTurnoverFallback;
          const monthlyTurnoverRate = effectiveTurnoverRate / 100 / 12;
          const turnoverLosses = Math.round(runningBrut * monthlyTurnoverRate * 10) / 10;
          if (annee === selectedYear) {
            scenarioTurnoverLossesTotal += turnoverLosses;
            if (m === selectedMonth) scenarioTurnoverLossesMoisAffiche = turnoverLosses;
          }

          const knownDeps = combinedDepCountByMonth.get(`${annee}-${m}`) || 0;

          const dataExitsList = allEmployees.filter((s) => {
            if (!s.date_sortie || s.est_sortie_temporaire) return false;
            const d = new Date(s.date_sortie);
            let depMonth = d.getMonth() + 1;
            let depYear = d.getFullYear();
            const ldm = lastDayOfMonth(depYear, depMonth);
            if (s.date_sortie === ldm) {
              depMonth += 1;
              if (depMonth > 12) { depMonth = 1; depYear += 1; }
            }
            return depMonth === m && depYear === annee;
          });
          const dataExits = dataExitsList.reduce((sum, s) => sum + getEtp(s), 0);

          const dataArrivalsList = allEmployees.filter((s) => {
            if (!s.date_entree) return false;
            const d = new Date(s.date_entree);
            return d.getMonth() + 1 === m && d.getFullYear() === annee;
          });
          const dataArrivals = dataArrivalsList.reduce((sum, s) => sum + getEtp(s), 0);

          const arriveesHyp = arriveesDuMois(combinedArrivals, m, annee);
          const arrivals = arriveesHyp.reduce((sum, h) => sum + h.nb_personnes, 0);
          const finsCddHyp = finsDeCddDuMois(combinedArrivals, m, annee);
          const cddDepartures = finsCddHyp.reduce((sum, h) => sum + h.nb_personnes, 0);
          const returns = combinedReturnCountByMonth.get(`${annee}-${m}`) || 0;

          const totalDepartures = Math.max(knownDeps, dataExits) + turnoverLosses + cddDepartures;
          const totalArrivals = arrivals + dataArrivals;

          runningBrut = Math.max(0, runningBrut - totalDepartures + totalArrivals + returns);

          const monthEnd = lastDayOfMonth(annee, m);
          const activeAtMonth = getActiveEmployeesAt(monthEnd);
          const dataTempExitsEtp = activeAtMonth
            .filter((s) => isTempExitAt(s, monthEnd))
            .reduce((sum, s) => sum + getEtp(s), 0);

          const tempExitHypDepartures = getTempExitDeparturesForMonth(combinedTempExits, m, annee);
          const tempExitHypReturns = getTempExitReturnsForMonth(combinedTempExits, m, annee);
          cumulTempExitHyp = Math.max(0, cumulTempExitHyp + tempExitHypDepartures - tempExitHypReturns);
          const runningTempExitsEtp = dataTempExitsEtp + cumulTempExitHyp;

          const scenarioNet = runningBrut - runningTempExitsEtp;

          const cnsRate = lastKnownCnsRate ?? 0;
          const scenarioCnsEtp = scenarioNet * (cnsRate / 100);
          const scenarioReel = scenarioNet - scenarioCnsEtp;

          const absRate = combinedAbsRateByMonth.get(m) ?? 5;
          const scenarioMctFte = scenarioNet * (absRate / 100);

          const scenarioBrutR = Math.round(runningBrut * 10) / 10;
          const scenarioNetR = Math.max(0, Math.round(scenarioNet * 10) / 10);
          const scenarioReelR = Math.max(0, Math.round(scenarioReel * 10) / 10);
          const scenarioApresMctR = Math.max(0, Math.round((scenarioReel - scenarioMctFte) * 10) / 10);

          // Journal : tous les mois projetés, y compris ceux qui ne sont pas
          // tracés (fin de l'année en cours d'une année future).
          journal.push({
            annee,
            mois: m,
            runningBrutAvant,
            turnoverLosses,
            departsHyp: knownDeps,
            dataExits,
            departsRetenus: Math.max(knownDeps, dataExits),
            dataExitsCodes: dataExitsList.map((s) => s.code_salarie),
            dataArrivalsCodes: dataArrivalsList.map((s) => s.code_salarie),
            arriveesHyp,
            arrivalsEtp: arrivals,
            dataArrivals,
            finsCddHyp,
            cddDepartures,
            retours: returns,
            tempExitsEtp: runningTempExitsEtp,
            cnsRate,
            absRate,
            scenario_brut: scenarioBrutR,
            scenario_net: scenarioNetR,
            scenario_reel: scenarioReelR,
            scenario_apres_mct: scenarioApresMctR,
          });

          // Seuls les mois de l'année affichée sont rendus ; les mois antérieurs
          // (fin de l'année en cours) ne servent qu'à enchaîner la projection.
          if (annee !== selectedYear) continue;
          combinedMonths.push({
            month_index: m,
            scenario_brut: scenarioBrutR,
            scenario_net: scenarioNetR,
            scenario_reel: scenarioReelR,
            scenario_apres_mct: scenarioApresMctR,
          });

          // Capture KPI overrides for the selected month
          if (m === selectedMonth) {
            scenarioKpiOverride = {
              effectif_brut: scenarioBrutR,
              effectif_net: scenarioNetR,
              sorties_temporaires: Math.round(runningTempExitsEtp * 10) / 10,
              taux_absenteisme: cnsRate,
              taux_mct: absRate,
            };
          }
        }

        scenarioProjections.push({ scenario_id: "__combined__", months: combinedMonths });
        journalCombine = journal;

        // Compute leave (congés) pool and distribute by monthly rate
        // 1. Collect effectif_net for all 12 months (real or projected)
        let sumNetAnnual = 0;
        for (let m = 1; m <= 12; m++) {
          const projMonth = combinedMonths.find((cm) => cm.month_index === m);
          if (projMonth) {
            sumNetAnnual += projMonth.scenario_net;
          } else {
            sumNetAnnual += headcountData[m - 1]?.effectif_net ?? 0;
          }
        }
        const avgNetAnnual = sumNetAnnual / 12;
        // 2. Total leave pool in FTE-months: avgNet × 240h / 173h
        const totalLeavePoolFte = avgNetAnnual * 240 / 173;
        // 3. Distribute by monthly rate and inject into headcountData + combinedMonths
        for (let m = 1; m <= 12; m++) {
          const leaveRate = combinedLeaveRateByMonth.get(m) ?? 0;
          const leaveFteMonth = totalLeavePoolFte * (leaveRate / 100);
          const projMonth = combinedMonths.find((cm) => cm.month_index === m);
          if (projMonth) {
            projMonth.scenario_apres_conges = Math.max(0, Math.round((projMonth.scenario_apres_mct - leaveFteMonth) * 10) / 10);
          }
          const journalMois = journal.find((j) => j.annee === selectedYear && j.mois === m);
          if (journalMois) journalMois.leaveFte = leaveFteMonth;
          const hd = headcountData[m - 1];
          if (hd) {
            const base = hd.base_scenario_apres_mct ?? hd.effectif_reel ?? hd.effectif_net;
            if (base != null) {
              hd.scenario_apres_conges = Math.max(0, Math.round((base - leaveFteMonth) * 10) / 10);
            }
          }
        }
      }
    }
  }

  return {
    scenarioProjections,
    journalCombine,
    hypotheses: {
      arrivals: hypArrivals,
      departures: hypDepartures,
      tempExits: hypTempExits,
      turnoverRates: hypTurnoverRates,
      absRates: hypAbsRates,
      leaveRates: hypLeaveRates,
      turnoverSrcName: hypTurnoverSrcName,
      absSrcName: hypAbsSrcName,
      leaveSrcName: hypLeaveSrcName,
    },
    scenarioKpiOverride,
    scenarioTurnoverLossesTotal,
    scenarioTurnoverLossesMoisAffiche,
  };
}
