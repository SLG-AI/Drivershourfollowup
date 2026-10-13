import { describe, expect, it } from "vitest";
import { concentrationParGroupe, mesurerConcentration, recurrenceDuTop } from "../concentration";

const n = (len: number, v: number) => Array.from({ length: len }, () => v);

describe("mesurerConcentration", () => {
  it("charge uniforme : Gini nul, top 10 % = 10 %", () => {
    const c = mesurerConcentration(n(40, 2))!;
    expect(c.gini).toBeCloseTo(0);
    expect(c.partTop10).toBeCloseTo(0.1);
    expect(c.moyenne).toBe(2);
    expect(c.mediane).toBe(2);
  });

  it("toute la charge sur un chauffeur : Gini proche de 1, top 10 % porte tout", () => {
    const c = mesurerConcentration([...n(39, 0), 20])!;
    expect(c.gini).toBeCloseTo(39 / 40);
    expect(c.partTop10).toBe(1);
    expect(c.concernes).toBe(1);
    expect(c.moyennesDeciles![9]).toBe(5);
  });

  it("moyenne trompeuse : même moyenne, concentration très différente", () => {
    const etale = mesurerConcentration(n(30, 3))!;
    const concentre = mesurerConcentration([...n(27, 0), 30, 30, 30])!;
    expect(etale.moyenne).toBe(concentre.moyenne);
    expect(concentre.gini).toBeGreaterThan(0.8);
    expect(concentre.mediane).toBe(0);
  });

  it("ne publie rien sous 3 chauffeurs", () => {
    expect(mesurerConcentration([5, 1])).toBeNull();
  });

  it("retient les mesures qui désigneraient une personne dans un petit groupe", () => {
    const c = mesurerConcentration([1, 2, 3, 4, 5])!;
    expect(c.mediane).toBeNull();
    expect(c.p90).toBeNull();
    expect(c.partTop20).toBeNull();
    expect(c.partTop10).toBeNull();
    expect(c.moyennesDeciles).toBeNull();
    expect(c.gini).toBeGreaterThan(0);
  });

  it("compte les chauffeurs au-delà d'un seuil et traite les négatifs comme zéro", () => {
    const c = mesurerConcentration([-2, 0, 4, 10, 12], 10)!;
    expect(c.auDelaDuSeuil).toEqual({ seuil: 10, chauffeurs: 2 });
    expect(c.total).toBe(26);
  });
});

describe("concentrationParGroupe", () => {
  it("fond les dépôts de moins de 3 chauffeurs avant de mesurer", () => {
    const valeurs = [
      ...["a", "b", "c", "d"].map((c) => ({ code_salarie: c, valeur: 2 })),
      { code_salarie: "e", valeur: 9 },
      { code_salarie: "f", valeur: 1 },
    ];
    const depot = (c: string) => (["a", "b", "c", "d"].includes(c) ? "Grand" : c === "e" ? "Petit1" : "Petit2");
    const res = concentrationParGroupe(valeurs, depot, "(sans)", "Autres dépôts");
    expect(res.map((g) => [g.cle, g.effectif])).toEqual([["Autres dépôts (3)", 6]]);
  });
});

describe("recurrenceDuTop", () => {
  const periode = (valeurs: number[]) => valeurs.map((v, i) => ({ code_salarie: `c${i}`, valeur: v }));

  it("les mêmes chauffeurs restent en tête", () => {
    const vs = Array.from({ length: 30 }, (_, i) => i);
    expect(recurrenceDuTop(periode(vs), periode(vs))).toEqual({ tailleTop: 3, dejaDansLeTop: 3, taux: 1 });
  });

  it("le top change entièrement", () => {
    const avant = Array.from({ length: 30 }, (_, i) => i);
    const apres = Array.from({ length: 30 }, (_, i) => 30 - i);
    expect(recurrenceDuTop(periode(avant), periode(apres))!.taux).toBe(0);
  });

  it("ne mesure pas un top de moins de 3 personnes", () => {
    expect(recurrenceDuTop(periode([1, 2, 3, 4, 5]), periode([1, 2, 3, 4, 5]))).toBeNull();
  });
});
