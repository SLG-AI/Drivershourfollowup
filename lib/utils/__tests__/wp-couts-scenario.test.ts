import { describe, expect, it } from "vitest";
import { coutEtpDuMois, valoriserProjection, type EntreesValorisation } from "../wp-couts-scenario";
import type { JournalMoisProjection } from "../wp-projection-scenarios";
import type { ArrivalHypothesis } from "../wp-calculations";
import type { SalarieCout } from "../wp-couts";
import { construireSourceSalaires } from "../wp-couts";
import type { LevierCout } from "../wp-leviers-cout";

// Journal minimal de trois mois (oct–déc 2026), écrit à la main : ce que le
// moteur de projection émet, en ETP.
const A: SalarieCout = { code_salarie: "A", taux_occupation: 100, est_sortie_temporaire: false, brut_indice: 4000, centre_cout: "SLA202", description_fonction: "CHAUFFEUR DE BUS", type_contrat: "CDI CHAUFF. BUS" };
const B: SalarieCout = { code_salarie: "B", taux_occupation: 100, est_sortie_temporaire: false, brut_indice: 2000, centre_cout: "SLA210", description_fonction: "CHAUFFEUR CAMIONNETTES", type_contrat: "CDI CHAUFF. CAM." };
const COEF = 1.15;
const PREMIER = { mois: 10, annee: 2026 };

const arrivee: ArrivalHypothesis = {
  id: "h1", scenario_id: "sc", nb_personnes: 1, taux_occupation: 100, fonction: "CHAUFFEUR DE BUS", centre_cout: "SLA202", depot: null,
  type_contrat: "CDD", vehicle_type: "BUS", start_day: 1, start_month: 10, start_year: 2026, end_day: 30, end_month: 11, end_year: 2026,
};

function journal(mois: number, extra: Partial<JournalMoisProjection> = {}): JournalMoisProjection {
  return {
    annee: 2026, mois, runningBrutAvant: 2, turnoverLosses: 0, departsHyp: 0, dataExits: 0, departsRetenus: 0,
    dataExitsCodes: [], dataArrivalsCodes: [], arriveesHyp: [], arrivalsEtp: 0, dataArrivals: 0, finsCddHyp: [], cddDepartures: 0,
    retours: 0, tempExitsEtp: 0, cnsRate: 0, absRate: 0, injRate: null, scenario_brut: 2, scenario_net: 2, scenario_reel: 2, scenario_apres_mct: 2,
    ...extra,
  };
}

function entrees(leviers: LevierCout[] = []): EntreesValorisation {
  return {
    photoDepart: [A, B],
    source: construireSourceSalaires([A, B], null),
    populationReference: [A, B],
    coefBase: COEF,
    leviers,
    premierMoisProjete: PREMIER,
    coutEtpDefaut: 3000 * COEF,
  };
}

describe("valoriserProjection", () => {
  it("part de la masse du dernier mois réel et la garde sans mouvement ni levier", () => {
    const r = valoriserProjection([journal(10), journal(11), journal(12)], entrees());
    expect(r.mois.map((m) => m.scenario_brut)).toEqual([6900, 6900, 6900]); // (4000 + 2000) × 1,15
    expect(r.mois[0].coutEtp).toBe(3450);
    expect(r.sources).toEqual([]);
  });

  it("valorise turnover, suspensions et taux au coût moyen par ETP du mois", () => {
    const r = valoriserProjection([journal(10, { turnoverLosses: 0.5, tempExitsEtp: 0.5, cnsRate: 10, absRate: 5, leaveFte: 0.2 })], entrees());
    const m = r.mois[0];
    expect(m.scenario_brut).toBe(6900 - 0.5 * 3450); // 5175
    expect(m.scenario_net).toBe(5175 - 0.5 * 3450); // 3450
    expect(m.scenario_reel).toBe(Math.round(3450 * 0.9));
    expect(m.scenario_apres_mct).toBe(Math.round(3450 * 0.9 - 3450 * 0.05));
    expect(m.scenario_apres_conges).toBe(Math.round(3450 * 0.9 - 3450 * 0.05 - 0.2 * 3450));
  });

  it("valorise une arrivée au coût de son profil et retire sa fin de CDD au même coût", () => {
    const r = valoriserProjection(
      [journal(10, { arriveesHyp: [arrivee], arrivalsEtp: 1 }), journal(11), journal(12, { finsCddHyp: [arrivee], cddDepartures: 1 })],
      entrees()
    );
    // Profil chauffeur de bus CDD, SLA202 : aucun CDD dans la population ⇒ repli « cc + fonction » = A (4 000 €)
    expect(r.mois[0].scenario_brut).toBe(6900 + 4000 * COEF);
    expect(r.mois[1].scenario_brut).toBe(6900 + 4000 * COEF);
    expect(r.mois[2].scenario_brut).toBe(6900);
    expect(r.sources.map((s) => [s.sens, s.cout.niveau, s.cout.coutEtp])).toEqual([
      ["arrivee", "cc_fonction", 4000 * COEF],
      ["fin_cdd", "cc_fonction", 4000 * COEF],
    ]);
  });

  it("applique une indexation d'un cost center à sa seule masse, à partir de son mois d'effet", () => {
    const leviers: LevierCout[] = [{ type: "indexation", centre_cout: "SLA202", annee_effet: 2026, mois_effet: 11, valeur: 2.5, mode: "pct" }];
    const r = valoriserProjection([journal(10), journal(11), journal(12)], entrees(leviers));
    expect(r.mois[0].scenario_brut).toBe(6900);
    expect(r.mois[1].scenario_brut).toBe(Math.round((4000 * 1.025 + 2000) * COEF)); // 7015
    expect(r.mois[2].scenario_brut).toBe(Math.round((4000 * 1.025 + 2000) * COEF));
  });

  it("relève au salaire minimum les seuls salariés sous le seuil, et ajoute les primes du mois exact", () => {
    const leviers: LevierCout[] = [
      { type: "ssm", centre_cout: null, annee_effet: 2026, mois_effet: 10, valeur: 3000, mode: "seuil_etp" },
      { type: "prime", centre_cout: null, annee_effet: 2026, mois_effet: 12, valeur: 500, mode: "montant_global" },
    ];
    const r = valoriserProjection([journal(10), journal(11), journal(12)], entrees(leviers));
    expect(r.mois[0].scenario_brut).toBe(Math.round((4000 + 3000) * COEF)); // B relevé à 3 000
    expect(r.mois[1].primes).toBe(0);
    expect(r.mois[2].primes).toBe(500);
    expect(r.mois[2].scenario_brut).toBe(Math.round((4000 + 3000) * COEF) + 500);
    expect(r.mois[2].scenario_apres_mct).toBe(Math.round((4000 + 3000) * COEF) + 500);
  });

  it("un coefficient forcé remplace le coefficient de base dès son mois d'effet", () => {
    const leviers: LevierCout[] = [{ type: "coefficient", centre_cout: null, annee_effet: 2026, mois_effet: 11, valeur: 1.2, mode: "coef" }];
    expect(coutEtpDuMois(entrees(leviers), { mois: 10, annee: 2026 })).toEqual({ coutEtp: 3450, coefficient: COEF });
    expect(coutEtpDuMois(entrees(leviers), { mois: 11, annee: 2026 })).toEqual({ coutEtp: 3600, coefficient: 1.2 });
    const r = valoriserProjection([journal(10), journal(11)], entrees(leviers));
    expect(r.mois[1].scenario_brut).toBe(7200);
  });
});

// ============================================================
// Compléments récurrents dans la projection
// ============================================================
import { calculerComplementsRecurrents } from "../wp-couts";

describe("valoriserProjection — compléments récurrents", () => {
  // Août 2026 : SLA202 porte 8 % de 13e mois + 2 % de prime de fonction, SLA210 5 % de 13e mois
  const complements = calculerComplementsRecurrents([
    { code_salarie: "A", mois: 8, annee: 2026, type_remuneration: "salaire", centre_cout: "SLA202", brut_base: 4000, nat_cct: 320, nat_pr_f: 80 },
    { code_salarie: "B", mois: 8, annee: 2026, type_remuneration: "salaire", centre_cout: "SLA210", brut_base: 2000, nat_cct: 100, nat_pr_f: 0 },
  ]);

  it("le coût par ETP d'un mois projeté porte le taux du cost center, comme la chaîne des coûts réels", () => {
    const sans = coutEtpDuMois(entrees(), PREMIER);
    const avec = coutEtpDuMois({ ...entrees(), complements }, PREMIER);
    // A : 4000 × 1,10 ; B : 2000 × 1,05 ; deux ETP
    expect(avec.coutEtp).toBeCloseTo(((4000 * 1.1 + 2000 * 1.05) / 2) * COEF, 6);
    expect(sans.coutEtp).toBeCloseTo(3000 * COEF, 6);
  });

  it("une hypothèse d'arrivée ne porte que la prime de fonction de son cost center, pas le 13e mois", () => {
    const j = [journal(10, { arriveesHyp: [arrivee], arrivalsEtp: 1, scenario_brut: 3, scenario_net: 3, scenario_reel: 3, scenario_apres_mct: 3 })];
    const sans = valoriserProjection(j, entrees());
    const avec = valoriserProjection(j, { ...entrees(), complements });
    // Masse de départ avec compléments : (4000 × 1,10 + 2000 × 1,05) × coef ; arrivée : brut moyen du profil SLA202 (4000) × (1 + 2 %) × coef
    const departAvec = (4000 * 1.1 + 2000 * 1.05) * COEF;
    const arriveeAvec = 4000 * 1.02 * COEF;
    expect(avec.mois[0].scenario_brut).toBe(Math.round(departAvec + arriveeAvec));
    expect(sans.mois[0].scenario_brut).toBe(Math.round(6000 * COEF + 4000 * COEF));
  });
});
