import { describe, expect, it } from "vitest";
import { computeEffectifMoyen, estActifLe, joursDuMois, paliersEnMoyenne } from "../wp-effectif-moyen";

const AOUT = { mois: 8, annee: 2026, jours: 31 };

describe("joursDuMois", () => {
  it("connaît les mois de 28, 30 et 31 jours", () => {
    expect(joursDuMois(2026, 8)).toBe(31);
    expect(joursDuMois(2026, 9)).toBe(30);
    expect(joursDuMois(2026, 2)).toBe(28);
    expect(joursDuMois(2028, 2)).toBe(29);
  });
});

describe("estActifLe", () => {
  it("suit la règle du tableau de bord : entré au plus tard ce jour, pas sorti avant ce jour", () => {
    const e = { date_entree: "2026-08-10", date_sortie: "2026-08-20", est_sortie_temporaire: false };
    expect(estActifLe(e, "2026-08-09")).toBe(false);
    expect(estActifLe(e, "2026-08-10")).toBe(true);
    expect(estActifLe(e, "2026-08-20")).toBe(true);
    expect(estActifLe(e, "2026-08-21")).toBe(false);
  });

  it("garde un sorti en suspension de contrat", () => {
    const e = { date_sortie: "2026-03-01", est_sortie_temporaire: true };
    expect(estActifLe(e, "2026-08-15")).toBe(true);
  });
});

describe("computeEffectifMoyen", () => {
  it("compte un temps plein présent tout le mois pour 1 ETP", () => {
    const m = computeEffectifMoyen([{ date_entree: "2020-01-01", est_sortie_temporaire: false }], [], AOUT.mois, AOUT.annee);
    expect(m.brut).toBe(1);
    expect(m.net).toBe(1);
    expect(m.jours).toBe(31);
  });

  it("pondère par les jours de présence et par le taux d'occupation", () => {
    const m = computeEffectifMoyen(
      [
        { date_entree: "2026-08-01", date_sortie: "2026-08-10", est_sortie_temporaire: false, taux_occupation: 100 }, // 10 jours
        { date_entree: "2026-08-22", est_sortie_temporaire: false, taux_occupation: 50 }, // 10 jours à 0.5
      ],
      [],
      AOUT.mois,
      AOUT.annee
    );
    expect(m.brut).toBeCloseTo((10 + 5) / 31, 6);
  });

  it("compte les suspensions de contrat jour par jour et les retire du net", () => {
    const m = computeEffectifMoyen(
      [
        {
          date_entree: "2020-01-01",
          date_sortie: "2026-08-15",
          est_sortie_temporaire: true,
          date_fin_sortie_temporaire: "2027-02-14",
        },
      ],
      [],
      AOUT.mois,
      AOUT.annee
    );
    // sous contrat tout le mois ; suspendu à partir du 16 (date_sortie < jour) : 16 jours
    expect(m.brut).toBe(1);
    expect(m.suspendus).toBeCloseTo(16 / 31, 6);
    expect(m.net).toBeCloseTo(15 / 31, 6);
  });

  it("ne retire que la moitié de l'ETP pour un congé parental à temps partiel", () => {
    const m = computeEffectifMoyen(
      [
        {
          date_entree: "2020-01-01",
          est_sortie_temporaire: true,
          date_fin_sortie_temporaire: "2027-01-31",
          description_motif_sortie: "Conge Parental Temps Partiel",
          taux_occupation: 100,
        },
      ],
      [],
      AOUT.mois,
      AOUT.annee
    );
    expect(m.brut).toBe(1);
    expect(m.suspendus).toBe(0.5);
    expect(m.net).toBe(0.5);
  });

  it("compte à son taux, sans rien suspendre, un congé parental à temps partiel encodé par le taux", () => {
    const m = computeEffectifMoyen(
      [{ date_entree: "2020-01-01", est_sortie_temporaire: true, description_motif_sortie: "", taux_occupation: 50 }],
      [],
      AOUT.mois,
      AOUT.annee
    );
    expect(m.brut).toBe(0.5);
    expect(m.suspendus).toBe(0);
    expect(m.net).toBe(0.5);
  });

  it("compte un sorti absent de la photo jusqu'à sa date de sortie incluse, rien s'il est sorti avant le mois", () => {
    const m = computeEffectifMoyen(
      [],
      [
        { date_sortie: "2026-08-14", taux_occupation: 100 },
        { date_sortie: "2026-07-31", taux_occupation: 100 },
      ],
      AOUT.mois,
      AOUT.annee
    );
    expect(m.brut).toBeCloseTo(14 / 31, 6);
  });

  it("traite un taux absent comme un temps plein", () => {
    const m = computeEffectifMoyen([{ est_sortie_temporaire: false, taux_occupation: null }], [], 9, 2026);
    expect(m.brut).toBe(1);
  });
});

describe("paliersEnMoyenne", () => {
  // Août 2026, SLA202 + SLA206 : fin de mois 908,9 / 881,1 ; moyenne 913,7 / 887,1
  const fin = { effectif_brut: 908.9, effectif_net: 881.1, effectif_reel: 848.7, effectif_apres_injustifiees: 847.6, effectif_apres_mct: 796.9 };
  const moyenne = { brut: 913.7, net: 887.1 };

  it("prend sous contrat et net dans la moyenne journalière", () => {
    const m = paliersEnMoyenne(fin, moyenne);
    expect(m.effectif_brut).toBe(913.7);
    expect(m.effectif_net).toBe(887.1);
  });

  it("applique les mêmes taux d'absence à l'effectif net moyen", () => {
    const m = paliersEnMoyenne(fin, moyenne);
    // taux cumulé jusqu'au payé = 1 − 847,6 / 881,1 ; appliqué à 887,1
    expect(m.effectif_apres_injustifiees).toBeCloseTo(887.1 * (847.6 / 881.1), 1);
    expect(m.effectif_apres_mct).toBeCloseTo(887.1 * (796.9 / 881.1), 1);
    // l'ordre des paliers est conservé
    expect(m.effectif_reel!).toBeGreaterThan(m.effectif_apres_injustifiees!);
    expect(m.effectif_apres_injustifiees!).toBeGreaterThan(m.effectif_apres_mct!);
  });

  it("laisse absents les paliers absents, et ne divise pas par un net nul", () => {
    const m = paliersEnMoyenne({ effectif_brut: 0, effectif_net: 0, projected_apres_mct: 5 }, { brut: 0, net: 0 });
    expect(m.effectif_reel).toBeUndefined();
    expect(m.effectif_apres_mct).toBeUndefined();
    expect(m.projected_apres_mct).toBe(5);
  });
});

