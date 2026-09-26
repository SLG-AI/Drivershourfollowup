import { describe, it, expect } from "vitest";
import {
  brutPleinTempsAvecLeviers,
  coefficientPour,
  estEffectif,
  facteurHausse,
  leviersPour,
  MODE_PAR_TYPE,
  primesDuMois,
  seuilSsm,
  unite,
  type LevierCout,
  type MoisAnnee,
} from "../wp-leviers-cout";

const PREMIER: MoisAnnee = { mois: 10, annee: 2026 };
const m = (mois: number, annee = 2026): MoisAnnee => ({ mois, annee });

function levier(p: Partial<LevierCout> & { type: LevierCout["type"]; valeur: number }): LevierCout {
  return {
    centre_cout: null,
    annee_effet: 2026,
    mois_effet: 10,
    mode: MODE_PAR_TYPE[p.type][0],
    ...p,
  };
}

describe("leviersPour / estEffectif", () => {
  it("garde les leviers du cost center et les globaux, écarte les autres", () => {
    const leviers = [
      levier({ type: "indexation", valeur: 1, centre_cout: null }),
      levier({ type: "indexation", valeur: 2, centre_cout: "CC1" }),
      levier({ type: "indexation", valeur: 3, centre_cout: "CC2" }),
    ];
    expect(leviersPour(leviers, "CC1").map((l) => l.valeur)).toEqual([1, 2]);
    expect(leviersPour(leviers, null).map((l) => l.valeur)).toEqual([1]);
  });

  it("est effectif entre le premier mois projeté et m inclus, années comprises", () => {
    const l = levier({ type: "indexation", valeur: 1, mois_effet: 12, annee_effet: 2026 });
    expect(estEffectif(l, m(11), PREMIER)).toBe(false);
    expect(estEffectif(l, m(12), PREMIER)).toBe(true);
    expect(estEffectif(l, m(2, 2027), PREMIER)).toBe(true);
    // effet avant le premier mois projeté : jamais effectif
    const avant = levier({ type: "indexation", valeur: 1, mois_effet: 9 });
    expect(estEffectif(avant, m(12), PREMIER)).toBe(false);
  });
});

describe("facteurHausse", () => {
  const leviers = [
    levier({ type: "indexation", valeur: 2.5, mois_effet: 10 }),
    levier({ type: "augmentation", valeur: 2.5, mois_effet: 12 }),
  ];

  it("cumule les tranches multiplicativement", () => {
    expect(facteurHausse(leviers, null, m(9), PREMIER)).toBe(1);
    expect(facteurHausse(leviers, null, m(11), PREMIER)).toBeCloseTo(1.025, 10);
    expect(facteurHausse(leviers, null, m(12), PREMIER)).toBeCloseTo(1.050625, 10);
  });

  it("ignore une tranche antérieure au premier mois projeté", () => {
    const avecAncienne = [...leviers, levier({ type: "indexation", valeur: 10, mois_effet: 4 })];
    expect(facteurHausse(avecAncienne, null, m(12), PREMIER)).toBeCloseTo(1.050625, 10);
  });

  it("cumule les tranches du cost center et les globales", () => {
    const mixte = [
      levier({ type: "indexation", valeur: 2.5, mois_effet: 10 }),
      levier({ type: "augmentation", valeur: 2, mois_effet: 11, centre_cout: "CC1" }),
      levier({ type: "augmentation", valeur: 5, mois_effet: 11, centre_cout: "CC2" }),
    ];
    expect(facteurHausse(mixte, "CC1", m(12), PREMIER)).toBeCloseTo(1.025 * 1.02, 10);
    expect(facteurHausse(mixte, null, m(12), PREMIER)).toBeCloseTo(1.025, 10);
  });

  it("n'est pas influencé par les autres types de levier", () => {
    const autres = [
      levier({ type: "ssm", valeur: 3000 }),
      levier({ type: "coefficient", valeur: 1.4 }),
      levier({ type: "prime", valeur: 500 }),
    ];
    expect(facteurHausse(autres, null, m(12), PREMIER)).toBe(1);
  });
});

describe("seuilSsm / brutPleinTempsAvecLeviers", () => {
  const ssm = levier({ type: "ssm", valeur: 3000, mois_effet: 10 });

  it("relève un brut sous le seuil et laisse un brut au-dessus", () => {
    expect(brutPleinTempsAvecLeviers(2500, [ssm], null, m(11), PREMIER)).toEqual({ brut: 3000, releve: true });
    expect(brutPleinTempsAvecLeviers(3500, [ssm], null, m(11), PREMIER)).toEqual({ brut: 3500, releve: false });
  });

  it("rend null sans levier SSM, et le brut indexé inchangé", () => {
    expect(seuilSsm([], null, m(11), PREMIER)).toBeNull();
    expect(brutPleinTempsAvecLeviers(2500, [], null, m(11), PREMIER)).toEqual({ brut: 2500, releve: false });
  });

  it("relève le seuil par une indexation postérieure à son mois d'effet", () => {
    const leviers = [ssm, levier({ type: "indexation", valeur: 2.5, mois_effet: 12 })];
    expect(seuilSsm(leviers, null, m(11), PREMIER)).toBe(3000);
    expect(seuilSsm(leviers, null, m(12), PREMIER)).toBeCloseTo(3075, 10);
    // le brut indexé (2 500 × 1,025 = 2 562,5) reste sous le seuil relevé
    const r = brutPleinTempsAvecLeviers(2500, leviers, null, m(12), PREMIER);
    expect(r.releve).toBe(true);
    expect(r.brut).toBeCloseTo(3075, 10);
  });

  it("ne relève pas le seuil par une hausse de son propre mois d'effet", () => {
    const leviers = [ssm, levier({ type: "indexation", valeur: 2.5, mois_effet: 10 })];
    expect(seuilSsm(leviers, null, m(12), PREMIER)).toBe(3000);
  });

  it("prend le SSM le plus récent, le cost center primant sur le global", () => {
    const leviers = [
      levier({ type: "ssm", valeur: 3000, mois_effet: 10 }),
      levier({ type: "ssm", valeur: 3100, mois_effet: 12 }),
      levier({ type: "ssm", valeur: 2800, mois_effet: 10, centre_cout: "CC1" }),
    ];
    expect(seuilSsm(leviers, null, m(11), PREMIER)).toBe(3000);
    expect(seuilSsm(leviers, null, m(12), PREMIER)).toBe(3100);
    expect(seuilSsm(leviers, "CC1", m(12), PREMIER)).toBe(2800);
    expect(seuilSsm(leviers, "CC2", m(12), PREMIER)).toBe(3100);
  });

  it("ignore un SSM antérieur au premier mois projeté", () => {
    expect(seuilSsm([levier({ type: "ssm", valeur: 3000, mois_effet: 1 })], null, m(11), PREMIER)).toBeNull();
  });
});

describe("coefficientPour", () => {
  it("rend le coefficient de base sans levier effectif", () => {
    expect(coefficientPour([], null, m(11), PREMIER, 1.35)).toBe(1.35);
    const futur = [levier({ type: "coefficient", valeur: 1.5, mois_effet: 12 })];
    expect(coefficientPour(futur, null, m(11), PREMIER, 1.35)).toBe(1.35);
  });

  it("fait primer le coefficient forcé sur le calculé, le plus récent l'emportant", () => {
    const leviers = [
      levier({ type: "coefficient", valeur: 1.5, mois_effet: 10 }),
      levier({ type: "coefficient", valeur: 1.6, mois_effet: 12 }),
    ];
    expect(coefficientPour(leviers, null, m(11), PREMIER, 1.35)).toBe(1.5);
    expect(coefficientPour(leviers, null, m(12), PREMIER, 1.35)).toBe(1.6);
  });

  it("fait primer le cost center sur le global même plus récent", () => {
    const leviers = [
      levier({ type: "coefficient", valeur: 1.6, mois_effet: 12 }),
      levier({ type: "coefficient", valeur: 1.45, mois_effet: 10, centre_cout: "CC1" }),
    ];
    expect(coefficientPour(leviers, "CC1", m(12), PREMIER, 1.35)).toBe(1.45);
    expect(coefficientPour(leviers, "CC2", m(12), PREMIER, 1.35)).toBe(1.6);
  });
});

describe("primesDuMois", () => {
  const leviers = [
    levier({ type: "prime", valeur: 10000, mode: "montant_global", mois_effet: 12 }),
    levier({ type: "prime", valeur: 300, mode: "montant_etp", mois_effet: 12 }),
    levier({ type: "prime", valeur: 50, mode: "montant_etp", mois_effet: 12, centre_cout: "CC1" }),
  ];

  it("additionne les montants globaux et les montants par ETP × ETP payés", () => {
    expect(primesDuMois(leviers, null, m(12), 20)).toBe(10000 + 300 * 20);
    expect(primesDuMois(leviers, "CC1", m(12), 20)).toBe(10000 + 300 * 20 + 50 * 20);
  });

  it("ne compte que le mois d'effet exact", () => {
    expect(primesDuMois(leviers, null, m(11), 20)).toBe(0);
    expect(primesDuMois(leviers, null, m(1, 2027), 20)).toBe(0);
  });
});

describe("unite", () => {
  it("donne l'unité de chaque mode", () => {
    expect(unite("pct")).toBe("%");
    expect(unite("seuil_etp")).toBe("€ brut plein temps / mois");
    expect(unite("coef")).toBe("coefficient");
    expect(unite("montant_global")).toBe("€");
    expect(unite("montant_etp")).toBe("€ par ETP");
  });
});
