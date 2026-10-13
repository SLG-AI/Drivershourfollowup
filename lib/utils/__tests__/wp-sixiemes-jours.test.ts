import { describe, expect, it } from "vitest";
import {
  agregerSixiemesJours,
  libellePeriode,
  lignesDeLaPeriode,
  periodeRegleeParLaPaie,
  sixiemesJoursParPeriode,
  tranchesSixiemesJours,
  ventilerSixiemesJours,
  type LigneSixiemeJour,
} from "../wp-sixiemes-jours";

const ligne = (code: string, mois: number, annee: number, prr: number, fonction = "CHAUFFEUR BUS"): LigneSixiemeJour => ({
  code_salarie: code,
  mois,
  annee,
  fonction,
  nat_prr: prr,
});

describe("periodeRegleeParLaPaie — la dernière période close avant la paie", () => {
  it("janvier à avril règlent sept.–déc. de l'année précédente", () => {
    expect(periodeRegleeParLaPaie(1, 2026)).toEqual({ annee: 2025, numero: 3 });
    expect(periodeRegleeParLaPaie(2, 2026)).toEqual({ annee: 2025, numero: 3 });
  });
  it("mai à août règlent janv.–avr., septembre à décembre mai–août", () => {
    expect(periodeRegleeParLaPaie(5, 2026)).toEqual({ annee: 2026, numero: 1 });
    expect(periodeRegleeParLaPaie(6, 2026)).toEqual({ annee: 2026, numero: 1 });
    expect(periodeRegleeParLaPaie(9, 2026)).toEqual({ annee: 2026, numero: 2 });
  });
  it("libellé lisible", () => {
    expect(libellePeriode({ annee: 2025, numero: 3 })).toBe("P3 2025 (sept.–déc.)");
  });
});

describe("agregerSixiemesJours", () => {
  it("80 € le jour, lignes d'un même salarié additionnées, régularisation négative déduite", () => {
    const a = agregerSixiemesJours([ligne("a", 5, 2026, 240), ligne("a", 6, 2026, 80), ligne("b", 5, 2026, 160), ligne("b", 6, 2026, -160)]);
    expect(a).toEqual({ concernes: 1, chauffeurs: 2, jours: 4, montant: 320 });
  });
});

describe("sixiemesJoursParPeriode", () => {
  const lignes = [
    ligne("a", 1, 2026, 160), ligne("b", 1, 2026, 80), ligne("c", 1, 2026, 0),
    ligne("a", 2, 2026, 80),
    ligne("x", 1, 2026, 0, "EMPLOYE"),
    ligne("a", 5, 2026, 400), ligne("b", 5, 2026, 0),
  ];

  it("rattache les rattrapages à la période et lit la base au mois de paie principal", () => {
    const res = sixiemesJoursParPeriode(lignes);
    expect(res.map((p) => p.libelle)).toEqual(["P3 2025 (sept.–déc.)", "P1 2026 (janv.–avr.)"]);
    expect(res[0]).toMatchObject({ jours: 4, concernes: 2, montant: 320, moisPaie: 1, anneePaie: 2026, chauffeurs: 3 });
    expect(res[1]).toMatchObject({ jours: 5, concernes: 1, moisPaie: 5, chauffeurs: 2 });
  });

  it("restreint concernés et base au périmètre", () => {
    const res = sixiemesJoursParPeriode(lignes, new Set(["b", "c"]));
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ jours: 1, concernes: 1, chauffeurs: 2 });
  });

  it("lignesDeLaPeriode retrouve toutes les paies d'une période", () => {
    expect(lignesDeLaPeriode(lignes, { annee: 2025, numero: 3 })).toHaveLength(5);
  });
});

describe("ventilation et tranches", () => {
  it("fond les groupes de moins de 3 concernés", () => {
    const ls = [ligne("a", 5, 2026, 80), ligne("b", 5, 2026, 80), ligne("c", 5, 2026, 80), ligne("d", 5, 2026, 80, "FORMATEUR")];
    const v = ventilerSixiemesJours(ls, { mois: 5, annee: 2026 }, (l) => l.fonction, "(sans)", "Autres fonctions");
    expect(v.map((g) => g.cle)).toEqual(["Autres fonctions (2)"]);
  });

  it("range chaque salarié selon ses jours sur la période", () => {
    const ls = [ligne("a", 5, 2026, 80), ligne("b", 5, 2026, 80 * 5), ligne("c", 5, 2026, 80 * 10), ligne("d", 5, 2026, 0)];
    expect(tranchesSixiemesJours(ls).map((t) => t.salaries)).toEqual([1, 0, 0, 1, 0, 1]);
  });
});

describe("ventilerSixiemesJours — base des chauffeurs", () => {
  it("compte les chauffeurs au seul mois de paie principal et garde un groupe sans jour s'il a 3 chauffeurs", () => {
    const ls = [
      ...["a", "b", "c"].map((c) => ligne(c, 5, 2026, 80)),
      ligne("a", 6, 2026, 80),
      ...["d", "e", "f"].map((c) => ligne(c, 5, 2026, 0)),
    ];
    const depot = (l: LigneSixiemeJour) => (["a", "b", "c"].includes(l.code_salarie) ? "D1" : "D2");
    const v = ventilerSixiemesJours(ls, { mois: 5, annee: 2026 }, depot, "(sans)", "Autres");
    expect(v.map((g) => [g.cle, g.concernes, g.chauffeurs, g.jours])).toEqual([["D1", 3, 3, 4], ["D2", 0, 3, 0]]);
  });
});
