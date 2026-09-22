import { describe, expect, it } from "vitest";
import type { HeadcountDataPoint } from "@/components/workforce/headcount-evolution-chart";
import { projeterScenarios, type EntreesProjection, type SalarieProjection } from "../wp-projection-scenarios";
import { estActifLe } from "../wp-effectif-moyen";

// Test de caractérisation, écrit lors de l'extraction du calcul hors du
// tableau de bord : deux salariés, un scénario avec une hypothèse d'arrivée
// (2 personnes en octobre 2026) et un turnover de 12 %/an, projection
// d'octobre à décembre 2026 depuis un point de départ 10 brut / 9 net.
const A: SalarieProjection = { code_salarie: "A", taux_occupation: 100, date_entree: "2020-01-01", est_sortie_temporaire: false, centre_cout: "SLA202" };
const B: SalarieProjection = { code_salarie: "B", taux_occupation: 50, date_entree: "2021-06-01", est_sortie_temporaire: false, centre_cout: "SLA206" };
const SC = "sc-1";

const headcountData: HeadcountDataPoint[] = Array.from({ length: 12 }, (_, i) => ({
  month: String(i + 1),
  effectif_brut: 10,
  effectif_net: 9,
  effectif_reel: 8.5,
  is_projection: i >= 9,
}));

function entrees(extra: Partial<EntreesProjection> = {}): EntreesProjection {
  const allEmployees = [A, B];
  return {
    scenarioOptions: [{ id: SC, name: "Recrutement" }],
    selectedScenarioIds: [SC],
    turnoverSrcId: null,
    absSrcId: null,
    leaveSrcId: null,
    rows: {
      params: [],
      turnoverParams: [],
      leaveParams: [],
      departures: [],
      arrivals: [{
        id: "arr-1", scenario_id: SC, nb_personnes: 2, taux_occupation: 100, fonction: null, centre_cout: null, depot: null,
        type_contrat: "CDI", vehicle_type: "BUS", start_day: 1, start_month: 10, start_year: 2026, end_day: null, end_month: null, end_year: null,
      }],
      tempExits: [],
      details: [{ id: SC, projected_turnover_rate: 12 }],
    },
    selectedYear: 2026,
    selectedMonth: 11,
    allEmployees,
    getActiveEmployeesAt: (date) => allEmployees.filter((s) => estActifLe(s, date)),
    etapesProjection: [{ annee: 2026, mois: 10 }, { annee: 2026, mois: 11 }, { annee: 2026, mois: 12 }],
    departProjection: { brut: 10, net: 9 },
    lastKnownCnsRate: null,
    lastKnownInjRate: null,
    lastKnownMctRate: null,
    headcountData,
    ...extra,
  };
}

const arrondi1 = (n: number) => Math.round(n * 10) / 10;

describe("projeterScenarios", () => {
  const r = projeterScenarios(entrees());
  const propre = r.scenarioProjections[0];
  const combine = r.scenarioProjections.find((p) => p.scenario_id === "__combined__")!;

  it("projette 3 mois pour le scénario, puis la même chose en combiné", () => {
    expect(propre.scenario_id).toBe(SC);
    expect(propre.months.map((m) => m.month_index)).toEqual([10, 11, 12]);
    expect(combine.months.map((m) => m.scenario_brut)).toEqual(propre.months.map((m) => m.scenario_brut));
  });

  it("retire chaque mois round(running × 12 %/12 × 10)/10 et ajoute l'arrivée en octobre", () => {
    // Octobre : 10 − 0.1 + 2 ; novembre : 11.9 − 0.1 ; décembre : 11.8 − 0.1
    expect(propre.months.map((m) => m.scenario_brut)).toEqual([11.9, 11.8, 11.7]);
    // Sans suspension ni CNS connu : net = réel = brut ; après MCT = réel − 5 % par défaut
    expect(propre.months[0].scenario_net).toBe(11.9);
    expect(propre.months[0].scenario_reel).toBe(11.9);
    expect(propre.months[0].scenario_apres_mct).toBe(arrondi1(11.9 - 11.9 * 0.05));
  });

  it("tient un journal cohérent avec les mois projetés", () => {
    const j = r.journalCombine!;
    expect(j.map((x) => [x.annee, x.mois])).toEqual([[2026, 10], [2026, 11], [2026, 12]]);
    expect(j.map((x) => x.runningBrutAvant)).toEqual([10, 11.9, 11.8]);
    expect(j.map((x) => x.turnoverLosses)).toEqual([0.1, 0.1, 0.1]);
    expect(j.map((x) => x.arrivalsEtp)).toEqual([2, 0, 0]);
    expect(j[0].arriveesHyp.map((h) => h.id)).toEqual(["arr-1"]);
    expect(j[1].arriveesHyp).toEqual([]);
    expect(j.map((x) => x.departsRetenus)).toEqual([0, 0, 0]);
    expect(j.map((x) => x.dataExitsCodes)).toEqual([[], [], []]);
    expect(j.map((x) => x.scenario_brut)).toEqual(combine.months.map((m) => m.scenario_brut));
    expect(j[0]).toMatchObject({ cnsRate: 0, absRate: 5, tempExitsEtp: 0, retours: 0, cddDepartures: 0, leaveFte: 0 });
  });

  it("relève les KPI du mois affiché et les pertes par turnover", () => {
    expect(r.scenarioKpiOverride).toEqual({ effectif_brut: 11.8, effectif_net: 11.8, sorties_temporaires: 0, taux_absenteisme: 0, taux_mct: 5 });
    expect(r.scenarioTurnoverLossesMoisAffiche).toBe(0.1);
    expect(r.scenarioTurnoverLossesTotal).toBeCloseTo(0.3, 10);
    expect(r.hypotheses.arrivals).toHaveLength(1);
    expect(r.hypotheses.turnoverSrcName).toBe("Recrutement");
  });

  it("sans taux de congés, le disponible après congés égale l'après MCT", () => {
    expect(combine.months.map((m) => m.scenario_apres_conges)).toEqual(combine.months.map((m) => m.scenario_apres_mct));
    expect(headcountData[0].scenario_apres_conges).toBe(8.5);
  });

  it("sans scénario sélectionné : projections propres seulement, pas de journal", () => {
    const r2 = projeterScenarios(entrees({ selectedScenarioIds: [], headcountData: [] }));
    expect(r2.scenarioProjections.map((p) => p.scenario_id)).toEqual([SC]);
    expect(r2.journalCombine).toBeNull();
    expect(r2.scenarioKpiOverride).toBeNull();
  });
});
