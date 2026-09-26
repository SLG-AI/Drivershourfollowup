import { describe, expect, it } from "vitest";
import {
  estCongeParentalTempsPartielParTaux,
  estMotifParentalInconnu,
  fractionSuspendue,
  fractionSuspendueEmploye,
  suspensionPartielle,
  estFinDeMission,
  estSortieHorsTurnover,
} from "../wp-suspension";

describe("fractionSuspendue", () => {
  it("retire l'ETP entier pour un congé parental temps plein, une maternité, un congé sans solde ou un motif vide", () => {
    expect(fractionSuspendue("Conge Parental TP")).toBe(1);
    expect(fractionSuspendue("Congé de maternité")).toBe(1);
    expect(fractionSuspendue("Congé sans solde")).toBe(1);
    expect(fractionSuspendue("")).toBe(1);
    expect(fractionSuspendue(null)).toBe(1);
  });

  it("retire la moitié pour un congé parental à temps partiel, quelle que soit la graphie", () => {
    for (const motif of [
      "Conge Parental Temps Partiel",
      "Congé parental à temps partiel",
      "Conge Parental TPart",
      "Conge Parental MT",
      "Conge Parental mi-temps",
      "Conge Parental 50%",
    ]) {
      expect(fractionSuspendue(motif), motif).toBe(0.5);
      expect(suspensionPartielle(motif)?.label).toBe("Congé parental temps partiel");
    }
  });

  it("ne confond pas le code temps plein « TP » avec un temps partiel", () => {
    expect(suspensionPartielle("Conge Parental TP")).toBeNull();
  });
});

describe("estMotifParentalInconnu", () => {
  it("signale un motif parental ni temps plein ni temps partiel reconnu", () => {
    expect(estMotifParentalInconnu("Conge Parental TP")).toBe(false);
    expect(estMotifParentalInconnu("Conge Parental Temps Partiel")).toBe(false);
    expect(estMotifParentalInconnu("Conge Parental Fractionne")).toBe(true);
    expect(estMotifParentalInconnu("Congé de maternité")).toBe(false);
    expect(estMotifParentalInconnu("")).toBe(false);
  });
});

describe("congé parental à temps partiel encodé par le taux", () => {
  const parTaux = { est_sortie_temporaire: true, description_motif_sortie: "", date_debut_sortie_temporaire: null, date_fin_sortie_temporaire: null };

  it("reconnaît le drapeau sans motif ni dates, et lui seul", () => {
    expect(estCongeParentalTempsPartielParTaux(parTaux)).toBe(true);
    expect(estCongeParentalTempsPartielParTaux({ ...parTaux, description_motif_sortie: "Conge Parental TP" })).toBe(false);
    expect(estCongeParentalTempsPartielParTaux({ ...parTaux, date_debut_sortie_temporaire: "2026-08-01" })).toBe(false);
    expect(estCongeParentalTempsPartielParTaux({ ...parTaux, est_sortie_temporaire: false })).toBe(false);
  });

  it("ne retire rien de plus : le taux porte déjà la réduction", () => {
    expect(fractionSuspendueEmploye(parTaux)).toBe(0);
    expect(fractionSuspendueEmploye({ ...parTaux, description_motif_sortie: "Conge Parental TP", date_debut_sortie_temporaire: "2026-02-01" })).toBe(1);
    expect(fractionSuspendueEmploye({ ...parTaux, description_motif_sortie: "Conge Parental Temps Partiel", date_debut_sortie_temporaire: "2026-02-01" })).toBe(0.5);
  });
});

describe("estFinDeMission / estSortieHorsTurnover", () => {
  it("reconnaît le libellé SIRH « Fin de mission », insensible à la casse", () => {
    expect(estFinDeMission("Fin de mission")).toBe(true);
    expect(estFinDeMission("FIN DE MISSION")).toBe(true);
    expect(estFinDeMission("Licenciement")).toBe(false);
    expect(estFinDeMission(null)).toBe(false);
  });

  it("écarte du turnover les sorties temporaires et les fins de mission, pas un CDD rompu avant terme", () => {
    expect(estSortieHorsTurnover({ est_sortie_temporaire: true })).toBe(true);
    expect(estSortieHorsTurnover({ description_motif_sortie: "Fin de mission" })).toBe(true);
    expect(estSortieHorsTurnover({ description_motif_sortie: "Demission" })).toBe(false);
    // Le type de contrat n'entre pas en jeu : seul le motif décide
    expect(estSortieHorsTurnover({ ...{ type_contrat: "CDD CHAUF. BUS" }, description_motif_sortie: "Résiliation commun accord" })).toBe(false);
  });
});
