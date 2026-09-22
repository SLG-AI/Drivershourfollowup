import { describe, expect, it } from "vitest";
import { construireCourbeEffectifs } from "../wp-courbe-effectifs";
import { construireCourbeCouts } from "../wp-courbe-couts";
import type { SalarieCout } from "../wp-couts";
import { getWorkableHoursInMonth } from "../wp-calculations";

// Deux salariés au même brut plein temps : la courbe en euros doit être
// l'homothétie de la courbe en ETP (× brut × coefficient), mois mesurés et
// mois reportés compris.
const BRUT = 4000;
const COEF = 1.13;
const A: SalarieCout = { code_salarie: "A", taux_occupation: 100, date_entree: "2020-01-01", est_sortie_temporaire: false, brut_indice: BRUT, centre_cout: "SLA202" };
const B: SalarieCout = {
  code_salarie: "B", taux_occupation: 50, date_entree: "2021-01-01", est_sortie_temporaire: true, brut_indice: BRUT, centre_cout: "SLA202",
  date_sortie: "2026-03-01", date_debut_sortie_temporaire: "2026-03-01", date_fin_sortie_temporaire: "2026-12-31", description_motif_sortie: "Conge Parental TP",
};
const heuresAout = getWorkableHoursInMonth(2026, 8);
const absences = [{ code_salarie: "A", mois: 8, pct_absenteisme: 50 }];
const mct = [{ code_salarie: "A", mois: 8, duree_hrs: heuresAout / 4 }];
const inj = [{ code_salarie: "A", mois: 8, duree_hrs: heuresAout / 8 }];

const etp = construireCourbeEffectifs({
  selectedYear: 2026, selectedMonth: 8, now: new Date(2026, 8, 22), anneeFuture: false, filtresActifs: false, targetTotal: 0,
  photoDuMoisDe: () => [A, B], photoExacte: (m) => m === 8, sortisHorsPhotoPour: () => [],
  absences, mctHorsWeekEnd: mct, absencesInjustifiees: inj, absencesAnneePrec: [], mctAnneePrec: [], injAnneePrec: [],
});

describe("construireCourbeCouts", () => {
  const couts = construireCourbeCouts({
    headcountData: etp.headcountData, selectedYear: 2026, filtresActifs: false,
    photoDuMois: () => [A, B], photoReference: [A, B], coef: COEF,
    absences, mctHorsWeekEnd: mct, absencesInjustifiees: inj,
    stats: [{ code_salarie: "A", mois: 8, annee: 2026, total_brut: 4200, charges_patronales: 546 }, { code_salarie: "B", mois: 7, annee: 2026, total_brut: 0, cout_total_secu: 0 }],
  });
  const k = BRUT * COEF;

  it("est l'homothétie de la courbe ETP sur un mois mesuré, à l'euro près", () => {
    const e = etp.headcountData[7];
    const p = couts[7].point;
    expect(p.effectif_brut).toBe(Math.round(1.5 * k));
    expect(p.effectif_net).toBe(Math.round(1 * k));
    expect(p.effectif_reel).toBe(Math.round(0.5 * k));
    // injustifiées et MCT mesurés : 1/8 et 1/4 d'ETP retirés
    expect(p.effectif_apres_injustifiees).toBe(Math.round((0.5 - 0.125) * k));
    expect(p.effectif_apres_mct).toBe(Math.round((0.5 - 0.125 - 0.25) * k));
    expect(p.reporte).toEqual({ ...e.reporte, cout: false });
    expect(p.realise).toBe(4746);
  });

  it("applique les taux repris au coût net sur un mois sans données, sans réalisé", () => {
    const p = couts[8].point; // septembre : photo et taux d'août repris
    expect(p.effectif_reel).toBe(Math.round(1 * k * 0.5));
    expect(p.effectif_apres_injustifiees).toBe(Math.round(1 * k * (0.5 - 0.125)));
    expect(p.effectif_apres_mct).toBe(Math.round(1 * k * (0.5 - 0.125 - 0.25)));
    expect(p.reporte?.brut).toBe(true);
    expect(p.realise).toBeUndefined();
  });

  it("ne compte pas comme réalisé un mois dont les lignes de paie sont à zéro", () => {
    expect(couts[6].point.realise).toBeUndefined();
    expect(couts[6].realise.n).toBe(1);
  });

  it("signale un salaire lu hors de la photo du mois (photo « sans salaire »)", () => {
    const sansSalaire = [{ ...A, brut_indice: null }, { ...B, brut_indice: 0 }];
    const c = construireCourbeCouts({
      headcountData: etp.headcountData, selectedYear: 2026, filtresActifs: false,
      photoDuMois: () => sansSalaire, photoReference: [A, B], coef: COEF,
      absences, mctHorsWeekEnd: mct, absencesInjustifiees: inj, stats: [],
    });
    expect(c[7].point.effectif_brut).toBe(Math.round(1.5 * k)); // brut lu dans la référence
    expect(c[7].point.reporte?.cout).toBe(true);
    expect(c[7].point.reporte?.brut).toBe(true);
  });
});
