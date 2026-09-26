import { describe, expect, it } from "vitest";
import { fractionsDuMois, reconcilierPaie, type EntreesReconciliation } from "../wp-reconciliation-paie";
import { calculerComplementsRecurrents, construireSourceSalaires, type LignePaieDetaillee, type SalarieCout } from "../wp-couts";
import { getWorkableHoursInMonth } from "../wp-calculations";

const MOIS = 8, ANNEE = 2026; // 31 jours
const H = getWorkableHoursInMonth(ANNEE, MOIS);
const COEF = 1.15;

const A: SalarieCout = { code_salarie: "A", taux_occupation: 100, est_sortie_temporaire: false, brut_indice: 4000, centre_cout: "CC1", date_entree: "2020-01-01" };
// Entré le 21 : 11 jours sur 31
const B: SalarieCout = { code_salarie: "B", taux_occupation: 100, est_sortie_temporaire: false, brut_indice: 3000, centre_cout: "CC1", date_entree: "2026-08-21" };
// Suspendu tout le mois (congé parental temps plein) : payé contractuel 0, pas de paie
const C: SalarieCout = { code_salarie: "C", taux_occupation: 100, est_sortie_temporaire: true, brut_indice: 3500, centre_cout: "CC1", date_entree: "2020-01-01", date_sortie: "2026-07-01", description_motif_sortie: "Conge Parental TP", date_debut_sortie_temporaire: "2026-07-01", date_fin_sortie_temporaire: "2026-12-31" };
const photo = [A, B, C];

// Compléments mesurés : 8 % de 13e mois sur CC1
const complements = calculerComplementsRecurrents([
  { code_salarie: "A", mois: 8, annee: 2026, type_remuneration: "salaire", centre_cout: "CC1", brut_base: 4000, nat_cct: 320, nat_pr_f: 0 },
]);

const paie: LignePaieDetaillee[] = [
  // A : base fidèle à l'indice, 13e mois, nuit, retenue injustifiée ; charges légèrement sous le coefficient moyen
  { code_salarie: "A", mois: 8, annee: 2026, type_remuneration: "salaire", centre_cout: "CC1", brut_base: 4000, nat_cct: 320, nat_shn: 50, nat_abin: -100, total_brut: 4270, charges_patronales: 600, cout_employeur: 4870, avantages_nature: 0 },
  // B : payé 11/31 du mois, pas de 13e mois (ancienneté), voiture déduite
  { code_salarie: "B", mois: 8, annee: 2026, type_remuneration: "salaire", centre_cout: "CC1", brut_base: 1064.52, nat_n002: 100, total_brut: 1164.52, charges_patronales: 175, cout_employeur: 1239.52, avantages_nature: 100 },
  // X : sorti avant l'export du roster, payé en août
  { code_salarie: "X", mois: 8, annee: 2026, type_remuneration: "salaire", centre_cout: "CC1", brut_base: 1000, total_brut: 1000, charges_patronales: 150, cout_employeur: 1150, avantages_nature: 0 },
  // X : son solde de congés
  { code_salarie: "X", mois: 8, annee: 2026, type_remuneration: "non_periodique", centre_cout: "CC1", brut_base: 0, nat_dc: 500, total_brut: 500, charges_patronales: 75, cout_employeur: 575, avantages_nature: 0 },
];
const realise = paie.reduce((s, l) => s + Number(l.cout_employeur), 0);

function entrees(payeReference: number): EntreesReconciliation {
  return {
    mois: MOIS, annee: ANNEE, lignesPaie: paie, photo, source: construireSourceSalaires(photo, null),
    cns: [], injustifiees: [{ code_salarie: "A", mois: 8, duree_hrs: 8 }], heuresTravaillables: H,
    coef: COEF, complements, realise, payeReference,
  };
}

describe("fractionsDuMois", () => {
  it("compte les jours sous contrat et les jours suspendus, comme la moyenne du mois", () => {
    expect(fractionsDuMois(A, MOIS, ANNEE)).toEqual({ active: 1, suspendue: 0 });
    expect(fractionsDuMois(B, MOIS, ANNEE).active).toBeCloseTo(11 / 31, 9);
    expect(fractionsDuMois(C, MOIS, ANNEE)).toEqual({ active: 1, suspendue: 1 });
  });
});

describe("reconcilierPaie — chaque euro d'écart a une cause, l'identité est exacte", () => {
  // Coefficient réel = (brut + charges) / brut des lignes de salaire, avantages remis
  const sal = paie.filter((l) => l.type_remuneration === "salaire");
  const coefReel = sal.reduce((s, l) => s + Number(l.cout_employeur) + Number(l.avantages_nature), 0) / sal.reduce((s, l) => s + Number(l.total_brut), 0);
  const t = 320 / 4000;
  // Payé contractuel par salarié : A plein mois, B 11/31, C suspendu (0)
  const injA = (8 / H) * 4000 * (1 + t) * COEF;
  const payeA = 4000 * COEF * (1 + t) - injA;
  const payeB = 3000 * COEF * (11 / 31) * (1 + t);
  const payeParSalarie = payeA + payeB;

  it("refait le payé contractuel salarié par salarié (prorata, suspension, compléments, injustifiées)", () => {
    const r = reconcilierPaie(entrees(payeParSalarie));
    expect(r.payeParSalarie).toBeCloseTo(payeParSalarie, 6);
    expect(r.coefReel).toBeCloseTo(coefReel, 9);
  });

  it("attribue chaque ligne de paie : variables, régularisations, soldes, structure, périmètre", () => {
    const r = reconcilierPaie(entrees(payeParSalarie));
    const l = Object.fromEntries(r.groupes.flatMap((g) => g.lignes).map((x) => [x.cle, x]));
    expect(l.variables.montant).toBeCloseTo((50 + 100) * coefReel, 6); // nuit de A + voiture en brut de B
    expect(l.regularisations.montant).toBeCloseTo(-100 * coefReel, 6);
    expect(l.injustifiees_contractuel.montant).toBeCloseTo(injA, 6);
    expect(l.soldes.montant).toBeCloseTo(575, 6);
    expect(l.avantages.montant).toBeCloseTo(-100, 6);
    // A : brut de base = indice exactement ⇒ écart = base × (coefReel − COEF) ; B : idem au prorata (1064,52 vs 3000 × 11/31)
    expect(l.brut_base.montant).toBeCloseTo(4000 * coefReel - 4000 * COEF + 1064.52 * coefReel - 3000 * (11 / 31) * COEF, 6);
    // A : 320 réels vs 4000 × 8 % contractuel ; B : 0 réel vs contractuel au prorata
    expect(l["compléments"].montant).toBeCloseTo(320 * coefReel - 4000 * COEF * t + 0 - 3000 * (11 / 31) * COEF * t, 6);
    expect(l.hors_photo.montant).toBeCloseTo(1000 * coefReel, 6);
    expect(l.hors_photo.n).toBe(1);
    expect(l.sans_paie.montant).toBe(0); // C est suspendu : payé 0, rien à retirer
    // Charges : Σ (coût − (brut × coefReel − avantages)) = 0 par construction du coefficient réel
    expect(l.charges.montant).toBeCloseTo(0, 6);
  });

  it("la somme des lignes vaut l'écart ; la ligne « méthode » mesure l'écart entre la référence et le salarié par salarié", () => {
    const r = reconcilierPaie(entrees(payeParSalarie + 100));
    const somme = r.groupes.reduce((s, g) => s + g.montant, 0);
    expect(somme).toBeCloseTo(r.ecart, 6);
    expect(r.ecart).toBeCloseTo(realise - payeParSalarie - 100, 6);
    const methode = r.groupes.flatMap((g) => g.lignes).find((x) => x.cle === "methode")!;
    expect(methode.montant).toBeCloseTo(-100, 6);
  });

  it("un salarié sous contrat sans ligne de paie est retiré (le modèle le compte, la paie non)", () => {
    const D: SalarieCout = { code_salarie: "D", taux_occupation: 50, est_sortie_temporaire: false, brut_indice: 2000, centre_cout: "CC1", date_entree: "2020-01-01" };
    const e = { ...entrees(0), photo: [...photo, D], source: construireSourceSalaires([...photo, D], null) };
    const r = reconcilierPaie(e);
    const sansPaie = r.groupes.flatMap((g) => g.lignes).find((x) => x.cle === "sans_paie")!;
    expect(sansPaie.montant).toBeCloseTo(-(2000 * 0.5 * COEF * (1 + t)), 6);
    expect(sansPaie.n).toBe(1);
    expect(r.groupes.reduce((s, g) => s + g.montant, 0)).toBeCloseTo(r.ecart, 6);
  });
});
