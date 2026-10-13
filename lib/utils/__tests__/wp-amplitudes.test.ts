import { describe, expect, it } from "vitest";
import {
  agregerAmplitudes,
  amplitudesParMois,
  estChauffeur,
  tauxDuMois,
  tranchesParJournees,
  ventilerAmplitudes,
  type LigneAmplitude,
} from "../wp-amplitudes";

const ligne = (code: string, am1: number, am2: number, extra: Partial<LigneAmplitude> = {}): LigneAmplitude => ({
  code_salarie: code,
  mois: 8,
  fonction: "CHAUFFEUR BUS",
  nat_am1: am1,
  nat_am2: am2,
  ...extra,
});

const TAUX = { am1: 6.3, am2: 9.72 };

describe("tauxDuMois — le montant d'une journée est le plus fréquent", () => {
  it("prend le mode, pas le minimum qu'un rappel d'indexation fausserait", () => {
    const lignes = [ligne("a", 6.3, 9.72), ligne("b", 6.3, 0), ligne("c", 0.15, 19.44), ligne("d", 12.6, 9.72)];
    expect(tauxDuMois(lignes)).toEqual({ am1: 6.3, am2: 9.72 });
  });

  it("vaut null quand aucune ligne ne porte la prime", () => {
    expect(tauxDuMois([ligne("a", 0, 0)])).toEqual({ am1: null, am2: null });
  });
});

describe("agregerAmplitudes", () => {
  it("convertit les montants en journées et additionne les lignes d'un même salarié", () => {
    const a = agregerAmplitudes([ligne("a", 12.6, 0), ligne("a", 6.3, 0), ligne("b", 0, 19.44)], TAUX);
    expect(a.journeesAm1).toBe(3);
    expect(a.journeesAm2).toBe(2);
    expect(a.concernes).toBe(2);
    expect(a.concernesAm2).toBe(1);
    expect(a.am1).toBeCloseTo(18.9);
  });

  it("un rappel d'indexation seul ne fait pas une journée", () => {
    const a = agregerAmplitudes([ligne("a", 0.15 * 4, 0)], TAUX);
    expect(a.journeesAm1).toBe(0);
    expect(a.concernes).toBe(0);
    expect(a.am1).toBeCloseTo(0.6);
  });

  it("une régularisation négative annule la prime du même mois", () => {
    expect(agregerAmplitudes([ligne("a", 6.3, 0), ligne("a", -6.3, 0)], TAUX).concernes).toBe(0);
  });

  it("compte les chauffeurs comme base, pas les autres fonctions", () => {
    const a = agregerAmplitudes([ligne("a", 6.3, 0), ligne("b", 0, 0), ligne("c", 0, 0, { fonction: "EMPLOYE" })], TAUX);
    expect(a.chauffeurs).toBe(2);
  });
});

describe("estChauffeur", () => {
  it("reconnaît bus et camionnette, pas le reste", () => {
    expect(estChauffeur("CHAUFFEUR BUS")).toBe(true);
    expect(estChauffeur(" chauffeur camionnett")).toBe(true);
    expect(estChauffeur("OUVRIER")).toBe(false);
    expect(estChauffeur(null)).toBe(false);
  });
});

describe("amplitudesParMois", () => {
  it("lit le taux sur tout le mois, même quand le périmètre est filtré", () => {
    const lignes = [
      ligne("a", 6.15, 0, { mois: 6 }), ligne("b", 6.15, 0, { mois: 6 }), ligne("c", 12.3, 0, { mois: 6 }),
      ligne("a", 6.3, 0, { mois: 7 }), ligne("b", 6.3, 0, { mois: 7 }), ligne("c", 12.6, 0, { mois: 7 }),
    ];
    const res = amplitudesParMois(lignes, new Set(["c"]));
    expect(res.map((m) => m.mois)).toEqual([6, 7]);
    expect(res.map((m) => m.taux.am1)).toEqual([6.15, 6.3]);
    expect(res.map((m) => m.journeesAm1)).toEqual([2, 2]);
  });
});

describe("ventilerAmplitudes — anonymat", () => {
  it("écarte les groupes sans journée longue et fond ceux de moins de 3 concernés", () => {
    const lignes = [
      ...["a", "b", "c"].map((c) => ligne(c, 6.3, 0, { fonction: "CHAUFFEUR BUS" })),
      ligne("d", 6.3, 0, { fonction: "OUVRIER" }),
      ligne("e", 0, 0, { fonction: "EMPLOYE" }),
    ];
    const v = ventilerAmplitudes(lignes, TAUX, (l) => l.fonction, "(sans fonction)", "Autres fonctions");
    expect(v.map((g) => g.cle)).toEqual(["Autres fonctions (2)"]);
    expect(v[0].concernes).toBe(4);
  });
});

describe("tranchesParJournees", () => {
  it("range chaque salarié selon son total de journées longues", () => {
    const lignes = [ligne("a", 6.3, 0), ligne("b", 6.3, 9.72), ligne("c", 6.3 * 5, 0), ligne("d", 6.3 * 8, 9.72 * 4), ligne("e", 0, 0)];
    expect(tranchesParJournees(lignes, TAUX)).toEqual([
      { libelle: "1", salaries: 1 },
      { libelle: "2", salaries: 1 },
      { libelle: "3", salaries: 0 },
      { libelle: "4 à 5", salaries: 1 },
      { libelle: "6 à 9", salaries: 0 },
      { libelle: "10 et +", salaries: 1 },
    ]);
  });
});

describe("ventilerAmplitudes — groupes sans journée longue", () => {
  it("garde seul un dépôt de 3 chauffeurs sans journée longue (il vaut 0 par chauffeur)", () => {
    const lignes = [
      ...["a", "b", "c"].map((c) => ligne(c, 6.3, 0)),
      ...["d", "e", "f"].map((c) => ligne(c, 0, 0)),
    ];
    const depot = (l: LigneAmplitude) => (["a", "b", "c"].includes(l.code_salarie) ? "D1" : "D2");
    const v = ventilerAmplitudes(lignes, TAUX, depot, "(sans)", "Autres");
    expect(v.map((g) => [g.cle, g.concernes, g.chauffeurs])).toEqual([["D1", 3, 3], ["D2", 0, 3]]);
  });
});

describe("agregerAmplitudes — concernés par palier", () => {
  it("compte séparément les chauffeurs de chaque palier, un même chauffeur pouvant être dans les deux", () => {
    const a = agregerAmplitudes([ligne("a", 6.3, 0), ligne("b", 6.3, 9.72), ligne("c", 0, 19.44)], TAUX);
    expect([a.concernes, a.concernesAm1, a.concernesAm2]).toEqual([3, 2, 2]);
  });
});
