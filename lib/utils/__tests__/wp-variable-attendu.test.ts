import { describe, expect, it } from "vitest";
import { dimanchesDuMois, feriesLuxembourg, joursSixiemeEstimes, projeterDecomposition, projeterRealise, projeterVariable, treiziemeMoisEmployes, type HeuresMois, type LignePaieVariable } from "../wp-variable-attendu";

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("calendrier", () => {
  it("fériés luxembourgeois 2026 : fixes et mobiles (Pâques le 5 avril)", () => {
    expect(feriesLuxembourg(2026).map(iso)).toEqual([
      "2026-01-01", "2026-04-06", "2026-05-01", "2026-05-09", "2026-05-14", "2026-05-25",
      "2026-06-23", "2026-08-15", "2026-11-01", "2026-12-25", "2026-12-26",
    ]);
  });

  it("dimanches du mois", () => {
    expect(dimanchesDuMois(2026, 8)).toBe(5);
    expect(dimanchesDuMois(2026, 9)).toBe(4);
    expect(dimanchesDuMois(2025, 12)).toBe(4);
  });
});

function ligne(mois: number, natures: Record<string, number>, code = "A"): LignePaieVariable {
  return { code_salarie: code, mois, annee: 2026, ...natures };
}

function heures(code: string, mois: number, h: Partial<HeuresMois>, annee = 2026): HeuresMois {
  return { code_salarie: code, annee, mois, buffer_hours: 17, positive_hours: 0, missing_hours: 0, overtime_pay: 0, counter_end: 0, ...h };
}

describe("projeterVariable", () => {
  it("dimanches : taux par dimanche du mois PRÉCÉDENT, appliqué aux mois suivant le dernier payé", () => {
    // Paie d'avril = 5 dimanches de mars ; de mai = 4 dimanches d'avril : 30 000 € par dimanche
    const p = projeterVariable({ annee: 2026, lignesPaie: [ligne(4, { nat_shd: 150_000 }), ligne(5, { nat_shd: 120_000 })], heures: [] });
    expect(p.dernierMoisPaie).toBe(5);
    const juin = p.mois.find((m) => m.mois === 6)!;
    expect(juin.estime).toBe(true);
    // Juin paie les 5 dimanches de mai
    expect(juin.postes.dimanches.montant).toBeCloseTo(150_000, 0);
    expect(juin.declencheurs[0]).toBe("5 dimanches en mai");
    expect(p.mois.find((m) => m.mois === 5)!.estime).toBe(false);
  });

  it("fériés : un férié de samedi pèse moins qu'un férié de semaine, avec fourchette", () => {
    // Paie de juillet = férié du mardi 23 juin : 90 000 €
    const p = projeterVariable({ annee: 2026, lignesPaie: [ligne(7, { nat_hfm: 90_000 })], heures: [] });
    const sept = p.mois.find((m) => m.mois === 9)!; // 15 août, un samedi
    expect(sept.postes.feries.montant).toBeCloseTo(90_000 * 0.85, 0);
    expect(sept.postes.feries.bas).toBeCloseTo(90_000 * 0.6, 0);
    expect(sept.postes.feries.haut).toBeCloseTo(90_000, 0);
    expect(p.mois.find((m) => m.mois === 8)!.postes.feries.montant).toBe(0); // juillet sans férié
  });

  it("heures sup. : € par heure de décompte calé sur mai, appliqué au décompte d'août", () => {
    const lignesPaie = [ligne(5, { nat_hsm: 30_000 }), ligne(6, { nat_hsm: 2_000 }), ligne(7, { nat_hsm: 2_000 }), ligne(8, { nat_hsm: 2_000 })];
    const h = [
      heures("A", 4, { overtime_pay: 100, counter_end: 900 }), // 1 000 h ⇒ 30 €/h
      heures("A", 8, { overtime_pay: 200, counter_end: 1_800 }), // 2 000 h
    ];
    const p = projeterVariable({ annee: 2026, lignesPaie, heures: h });
    expect(p.mois.find((m) => m.mois === 9)!.postes.heures_sup.montant).toBeCloseTo(60_000, 0);
    expect(p.mois.find((m) => m.mois === 10)!.postes.heures_sup.montant).toBeCloseTo(2_000, 0);
    expect(p.mois.find((m) => m.mois === 9)!.declencheurs).toContain("décompte de fin de période (mai–août)");
  });
});

describe("joursSixiemeEstimes", () => {
  it("compteur plancher 0, jours au-delà de 5 dus, solde final dû ; null si un mois manque", () => {
    // Heures théoriques du jour = 17 × 10 / jours ouvrés du mois
    const jour = (m: number) => 170 / [0, 22, 20, 22, 22][m];
    const h = [
      heures("A", 1, { positive_hours: 4 * jour(1) }), // +4
      heures("A", 2, { positive_hours: 3 * jour(2) }), // 7 ⇒ 2 dus, compteur 5
      heures("A", 3, { missing_hours: 8 * jour(3) }), // plancher 0
      heures("A", 4, { positive_hours: 1 * jour(4) }), // 1
    ];
    expect(joursSixiemeEstimes(h, 2026, 4)!.get("A")).toBeCloseTo(3, 6);
    expect(joursSixiemeEstimes(h.slice(0, 3), 2026, 4)).toBeNull();
  });
});

describe("projeterRealise", () => {
  it("payé du mois + écart habituel hors variable + variable attendu chargé ; mai (bonus) exclu du socle", () => {
    const lignesPaie = [4, 5, 6, 7].map((m) => ligne(m, { nat_shn: 10_000 }));
    const variable = projeterVariable({ annee: 2026, lignesPaie, heures: [] });
    // Variable réel 10 000 € par mois ; coef 1,2 ⇒ 12 000 € chargés
    const points = Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      if (m === 5) return { realise: 900_000, paye: 500_000 }; // bonus : ignoré
      if (m >= 4 && m <= 7) return { realise: 500_000 + 30_000 + 12_000, paye: 500_000 };
      return { paye: 510_000 };
    });
    const r = projeterRealise({ points, variable, coef: 1.2 });
    expect(r.socle).toBeCloseTo(30_000, 6);
    expect(r.moisSocle).toEqual([4, 6, 7]);
    expect(r.valeurs[7]).toBe(510_000 + 30_000 + 12_000); // août, attendu
    expect(r.valeurs[6]).toBeUndefined(); // juillet, payé
  });
});

describe("projeterDecomposition", () => {
  it("planning = variable attendu, autres familles = moyenne hors mai, structurel = reste du réalisé attendu", () => {
    const lignesPaie = [6, 7].map((m) => ligne(m, { nat_shn: 10_000 }));
    const variable = projeterVariable({ annee: 2026, lignesPaie, heures: [] });
    const f = (structurel: number, primes: number) => ({ structurel, planning: 10_000, primes, regularisations: -1_000, soldes: 2_000, avantages: 500, non_verse: 300 });
    const parMois = [
      { mois: 5, familles: f(100_000, 90_000), brut: 0 }, // bonus : exclu
      { mois: 6, familles: f(100_000, 1_000), brut: 0 },
      { mois: 7, familles: f(100_000, 3_000), brut: 0 },
    ];
    const realiseAttendu: (number | undefined)[] = Array(12).fill(undefined);
    realiseAttendu[7] = 240_000; // août : 240 000 / 1,2 = 200 000 € de brut versé
    const [aout] = projeterDecomposition({ parMois, variable, realiseAttendu, coef: 1.2 });
    expect(aout.mois).toBe(8);
    expect(aout.moisReference).toEqual([6, 7]);
    expect(aout.familles.planning).toBeCloseTo(10_000, 6);
    expect(aout.familles.primes).toBeCloseTo(2_000, 6);
    expect(aout.brut).toBeCloseTo(200_000, 6);
    expect(aout.familles.structurel).toBeCloseTo(200_000 - 10_000 - 2_000 + 1_000 - 2_000 - 500, 6);
    expect(aout.structurelParDifference).toBe(true);
  });
});

describe("treiziemeMoisEmployes", () => {
  const l = (code: string, mois: number, fonction: string, brut_base: number, natures: Record<string, number> = {}) =>
    ({ code_salarie: code, mois, annee: 2026, type_remuneration: "salaire", fonction, brut_base, ...natures });

  it("un mois de brut de base du dernier mois payé, hors chauffeurs (fonction ou CCT) et hors cadres (N002 ou car allowance)", () => {
    const lignes = [
      l("E1", 8, "EMPLOYE DE BUREAU", 3_000),
      l("E2", 8, "EMPLOYE DE BUREAU", 3_500),
      l("E3", 8, "FORMATEUR CHBUS", 4_000, { nat_cct: 300 }), // complément mensuel ⇒ exclu
      l("C1", 8, "CHAUFFEUR BUS", 4_200), // chauffeur sans CCT (moins d'un an) ⇒ exclu quand même
      l("K1", 7, "RESPONSABLE", 6_000, { nat_n002: 400 }), // cadre repéré en juillet
      l("K1", 8, "RESPONSABLE", 6_000),
      l("K2", 8, "KEY ACCOUNT", 5_000, { nat_all: 300 }),
      l("E1", 7, "EMPLOYE DE BUREAU", 9_999), // mois antérieur : ignoré
      l("Q1", 8, "QUAL", 4_000), // seul de sa fonction
      l("L1", 8, "LOGISTE", 3_800), // seul de sa fonction
      l("S1", 8, "ETUDIANT", 900), // étudiant : pas de 13e mois
      l("A1", 8, "ACCOMP", 1_100), // accompagnateur : pas de 13e mois
      l("CS", 8, "CHEF DE SERVICE", 4_900), // chef de service sans voiture : exclu par sa fonction
      l("KA", 8, "KEY ACCOUNT", 7_800), // key account sans allowance : idem
      // Allowance saisie en « Autres CS » : 1 200 € fixes de janvier à mars ⇒ cadre
      l("D1", 1, "DIRECTEUR", 10_000, { nat_autres_cs: 1_200 }),
      l("D1", 2, "DIRECTEUR", 10_000, { nat_autres_cs: 1_200 }),
      l("D1", 3, "DIRECTEUR", 10_000, { nat_autres_cs: 1_200 }),
      l("D1", 8, "DIRECTEUR", 8_200),
      // Autres CS variable : pas une allowance
      l("E2", 5, "EMPLOYE DE BUREAU", 3_500, { nat_autres_cs: 150 }),
      l("E2", 6, "EMPLOYE DE BUREAU", 3_500, { nat_autres_cs: 220 }),
      l("E2", 7, "EMPLOYE DE BUREAU", 3_500, { nat_autres_cs: 180 }),
    ];
    const t = treiziemeMoisEmployes(lignes, 2026)!;
    expect(t.mois).toBe(12);
    expect(t.brut).toBe(14_300);
    expect(t.n).toBe(4);
    // Moins de 3 personnes par fonction : tout est regroupé, aucun salaire individuel lisible
    expect(t.detail).toEqual([{ libelle: "Autres fonctions", n: 4, brut: 14_300 }]);
  });

  it("entre dans le réalisé attendu de décembre (chargé) et donc dans le structurel", () => {
    const lignesPaie = [6, 7, 8].map((m) => ligne(m, { nat_shn: 10_000 }));
    const variable = projeterVariable({ annee: 2026, lignesPaie, heures: [] });
    const points = Array.from({ length: 12 }, (_, i) => (i < 8 ? { realise: 500_000 + 12_000, paye: 500_000 } : { paye: 500_000 }));
    const ponctuels = [{ mois: 12, libelle: "13e", brut: 100_000, n: 10, detail: [], hypothese: "" }];
    const sans = projeterRealise({ points, variable, coef: 1.2 });
    const avec = projeterRealise({ points, variable, coef: 1.2, ponctuels });
    expect(avec.valeurs[11]! - sans.valeurs[11]!).toBe(120_000);
    expect(avec.valeurs[10]).toBe(sans.valeurs[10]);
    const parMois = [6, 7, 8].map((m) => ({ mois: m, familles: { structurel: 400_000, planning: 10_000, primes: 0, regularisations: 0, soldes: 0, avantages: 0, non_verse: 0 }, brut: 410_000 }));
    const dec = projeterDecomposition({ parMois, variable, realiseAttendu: avec.valeurs, coef: 1.2, ponctuels }).find((d) => d.mois === 12)!;
    const nov = projeterDecomposition({ parMois, variable, realiseAttendu: avec.valeurs, coef: 1.2, ponctuels }).find((d) => d.mois === 11)!;
    expect(dec.familles.structurel - nov.familles.structurel).toBeCloseTo(100_000, 6);
    expect(dec.ponctuels).toHaveLength(1);
  });
});

describe("anonymisation du détail du 13e mois", () => {
  it("un « Autres fonctions » d'une seule personne absorbe le plus petit groupe", () => {
    const l = (code: string, fonction: string, brut_base: number) => ({ code_salarie: code, mois: 8, annee: 2026, type_remuneration: "salaire", fonction, brut_base });
    const t = treiziemeMoisEmployes([
      l("A", "EMPLOYE DE BUREAU", 3_000), l("B", "EMPLOYE DE BUREAU", 3_000), l("C", "EMPLOYE DE BUREAU", 3_000),
      l("D", "POMP", 3_500), l("E", "POMP", 3_500),
      l("F", "DATA AN", 6_400),
    ], 2026)!;
    expect(t.detail).toEqual([
      { libelle: "EMPLOYE DE BUREAU", n: 3, brut: 9_000 },
      { libelle: "Autres fonctions", n: 3, brut: 13_400 },
    ]);
  });
});
