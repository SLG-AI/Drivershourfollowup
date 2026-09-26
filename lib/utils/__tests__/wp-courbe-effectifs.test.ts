import { describe, expect, it } from "vitest";
import { construireCourbeEffectifs, type EntreesCourbe } from "../wp-courbe-effectifs";
import type { SalariePaliers } from "../wp-paliers";
import { getWorkableHoursInMonth } from "../wp-calculations";

// Test de caractérisation, écrit lors de l'extraction du calcul hors du
// tableau de bord : deux salariés, une photo d'août 2026 reconduite sur les
// autres mois, des absences en août seulement, « aujourd'hui » = 22/09/2026.
const A: SalariePaliers = { code_salarie: "A", taux_occupation: 100, date_entree: "2020-01-01", est_sortie_temporaire: false };
const B: SalariePaliers = {
  code_salarie: "B", taux_occupation: 50, date_entree: "2021-01-01", est_sortie_temporaire: true,
  date_sortie: "2026-03-01", date_debut_sortie_temporaire: "2026-03-01", date_fin_sortie_temporaire: "2026-12-31",
  description_motif_sortie: "Conge Parental TP",
};
const heuresAout = getWorkableHoursInMonth(2026, 8);

function entrees(extra: Partial<EntreesCourbe> = {}): EntreesCourbe {
  return {
    selectedYear: 2026,
    selectedMonth: 8,
    now: new Date(2026, 8, 22),
    anneeFuture: false,
    filtresActifs: false,
    targetTotal: 0,
    photoDuMoisDe: () => [A, B],
    photoExacte: (m) => m === 8,
    sortisHorsPhotoPour: () => [],
    absences: [{ code_salarie: "A", mois: 8, pct_absenteisme: 50 }],
    mctHorsWeekEnd: [{ code_salarie: "A", mois: 8, duree_hrs: heuresAout / 2 }],
    absencesInjustifiees: [],
    absencesAnneePrec: [],
    mctAnneePrec: [],
    injAnneePrec: [],
    ...extra,
  };
}

describe("construireCourbeEffectifs", () => {
  const r = construireCourbeEffectifs(entrees());
  const aout = r.headcountData[7];
  const sept = r.headcountData[8];

  it("déroule la chaîne du mois mesuré : sous contrat, net, réel, disponible", () => {
    expect(aout.effectif_brut).toBe(1.5);
    expect(aout.effectif_net).toBe(1); // B entièrement suspendu
    expect(aout.effectif_reel).toBe(0.5); // A absent à 50 %
    expect(aout.effectif_apres_injustifiees).toBeUndefined(); // aucun fichier, aucun taux connu
    expect(aout.effectif_apres_mct).toBe(0); // 84 h MCT = 0,5 ETP
    expect(aout.reporte).toEqual({ brut: false, net: false, reel: false, injustifiees: true, mct: true });
    expect(aout.taux_appliques).toEqual({ cns: 50, inj: null, mct: 50 });
  });

  it("reporte photo et taux sur un mois sans données, en gardant les taux appliqués", () => {
    expect(sept.is_projection).toBe(false); // septembre est le mois courant
    expect(sept.effectif_reel).toBe(0.5); // taux CNS d'août repris
    expect(sept.projected_apres_mct).toBe(0);
    expect(sept.effectif_apres_mct).toBeUndefined();
    expect(sept.reporte).toEqual({ brut: true, net: true, reel: true, injustifiees: true, mct: true });
    expect(sept.taux_appliques).toEqual({ cns: 50, inj: null, mct: 50 });
  });

  it("rend les taux repris, le taux CNS du mois affiché et le point de départ des projections", () => {
    expect(r.tauxRepris.cns).toEqual({ taux: 50, mois: 8, annee: 2026 });
    expect(r.tauxRepris.mct).toEqual({ taux: 50, mois: 8, annee: 2026 });
    expect(r.tauxRepris.inj).toBeNull();
    expect(r.avgAbsenteeism).toBe(50);
    expect(r.cnsEstimatedFromMonth).toBeNull();
    expect(r.etapesProjection).toEqual([{ annee: 2026, mois: 10 }, { annee: 2026, mois: 11 }, { annee: 2026, mois: 12 }]);
    expect(r.departProjection).toEqual({ brut: 1.5, net: 1 }); // dernier mois réel = septembre, photo reconduite
  });

  it("signale un taux CNS estimé quand le mois affiché n'a pas de fichier", () => {
    const r2 = construireCourbeEffectifs(entrees({ selectedMonth: 9 }));
    expect(r2.avgAbsenteeism).toBe(50);
    expect(r2.cnsEstimatedFromMonth).toEqual({ mois: 8, annee: 2026 });
  });
});
