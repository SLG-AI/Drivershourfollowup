/**
 * Réconciliation de la paie réalisée avec le payé contractuel, SALARIÉ PAR
 * SALARIÉ.
 *
 * POURQUOI. L'écart « réalisé − payé contractuel » d'un mois se lisait avec
 * trois lignes calculées (suppléments, régularisations, soldes) et un
 * « reste » obtenu par différence, nommé mais pas mesuré. Le reste mêle des
 * choses de sens opposé (sortants payés hors photo, compléments récurrents
 * réels vs taux, avantages déduits…) qui peuvent se compenser. Ce module
 * refait le payé contractuel par salarié, avec les mêmes règles que la
 * chaîne des coûts (brut indice × ETP × fraction du mois × (1 + compléments)
 * × coefficient, moins suspension, CNS et injustifiées), et attribue chaque
 * euro d'écart à une cause. L'identité est EXACTE par construction : la
 * somme des lignes vaut l'écart, la dernière ligne (« méthode ») mesurant ce
 * que la moyenne du mois, calculée à l'échelle, ne fait pas comme le
 * salarié par salarié.
 *
 * VÉRIFIÉ sur août 2026 : brut de base payé = brut indice × taux (médiane
 * 1,000) pour un mois complet sans absence CNS ; la paie NE paie PAS les
 * absences CNS (brut de base ≈ 26 % de l'indice à 50 % d'absence). Le payé
 * contractuel, qui retire la CNS, compare donc bien la même chose.
 *
 * Toutes les natures de paie sont ramenées en coût employeur au coefficient
 * RÉEL du mois ; l'écart entre ce coefficient moyen et les charges réelles
 * de chaque ligne (plafonds) est isolé dans « charges non proportionnelles ».
 */

import { estActifLe, joursDuMois } from "./wp-effectif-moyen";
import { fractionSuspendueEmploye } from "./wp-suspension";
import { isTempExitAt } from "./wp-calculations";
import { etpDe, type LigneCns, type LigneHeures } from "./wp-paliers";
import { NATURES, type FamilleNature } from "./wp-natures-paie";
import { NATURES_RECURRENTES, tauxComplementsDe, type ComplementsRecurrents, type LignePaieDetaillee, type SalarieCout, type SourceSalaires } from "./wp-couts";

export interface EntreesReconciliation {
  mois: number;
  annee: number;
  /** Lignes de paie du mois, dans le périmètre (salaire ET non périodique). */
  lignesPaie: LignePaieDetaillee[];
  /** Photo roster du mois, filtrée et reclassifiée, avec dates, taux, brut indice. */
  photo: SalarieCout[];
  source: SourceSalaires;
  /** Lignes CNS et injustifiées DU MOIS, périmètre appliqué. */
  cns: LigneCns[];
  injustifiees: LigneHeures[];
  heuresTravaillables: number;
  coef: number;
  coefParCc?: Map<string, { coef: number }>;
  complements?: ComplementsRecurrents | null;
  /** Coût employeur réalisé (Σ coût des lignes de paie du périmètre). */
  realise: number;
  /** Payé contractuel de référence (moyenne du mois, sinon fin de mois). */
  payeReference: number;
}

export type CleReconciliation =
  | "variables" | "regularisations" | "injustifiees_contractuel" | "soldes"
  | "compléments" | "brut_base" | "avantages" | "charges"
  | "hors_photo" | "sans_paie" | "methode";

export interface LigneReconciliation {
  cle: CleReconciliation;
  libelle: string;
  montant: number;
  /** Salariés concernés. */
  n: number;
}

export interface GroupeReconciliation {
  titre: string;
  montant: number;
  lignes: LigneReconciliation[];
}

export interface Reconciliation {
  ecart: number;
  coefReel: number;
  groupes: GroupeReconciliation[];
  /** Payé contractuel refait salarié par salarié (avant la ligne « méthode »). */
  payeParSalarie: number;
}

const nombre = (v: unknown): number => {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
};

const FAMILLE_DE: Record<`nat_${string}`, FamilleNature> = Object.fromEntries(NATURES.map((n) => [n.cle, n.famille])) as Record<`nat_${string}`, FamilleNature>;
const CLES_RECURRENTES = new Set<string>(NATURES_RECURRENTES.map((n) => n.cle));

/** Natures d'une ligne, réparties : récurrentes / régularisations / soldes / variables (tout le reste). */
function ventilerNatures(l: LignePaieDetaillee): { recurrents: number; regularisations: number; soldes: number; variables: number } {
  const r = { recurrents: 0, regularisations: 0, soldes: 0, variables: 0 };
  for (const n of NATURES) {
    const v = nombre(l[n.cle]);
    if (v === 0) continue;
    if (CLES_RECURRENTES.has(n.cle)) r.recurrents += v;
    else if (FAMILLE_DE[n.cle] === "regularisations") r.regularisations += v;
    else if (FAMILLE_DE[n.cle] === "soldes") r.soldes += v;
    else r.variables += v;
  }
  return r;
}

/**
 * Fraction du mois pendant laquelle un salarié est sous contrat, et fraction
 * pendant laquelle son ETP est suspendu — jour par jour, comme la moyenne du
 * mois (computeEffectifMoyen).
 */
export function fractionsDuMois(e: SalarieCout, mois: number, annee: number): { active: number; suspendue: number } {
  const jours = joursDuMois(annee, mois);
  let actifs = 0;
  let suspendus = 0;
  for (let j = 1; j <= jours; j++) {
    const date = `${annee}-${String(mois).padStart(2, "0")}-${String(j).padStart(2, "0")}`;
    if (!estActifLe(e, date)) continue;
    actifs += 1;
    if (isTempExitAt(e, date)) suspendus += fractionSuspendueEmploye(e);
  }
  return { active: actifs / jours, suspendue: suspendus / jours };
}

export function reconcilierPaie(e: EntreesReconciliation): Reconciliation {
  const ecart = e.realise - e.payeReference;
  // Coefficient de charges réel des lignes de salaire : (brut + charges) / brut,
  // avantages en nature remis (ils sont déduits du coût, pas des charges).
  const salaire = e.lignesPaie.filter((l) => l.type_remuneration !== "non_periodique");
  const brutTotal = salaire.reduce((s, l) => s + nombre(l.total_brut), 0);
  const brutCharge = salaire.reduce((s, l) => s + nombre(l.cout_employeur) + nombre(l.avantages_nature), 0);
  const coefReel = brutTotal > 0 ? brutCharge / brutTotal : e.coef;

  const photoParCode = new Map(e.photo.map((s) => [s.code_salarie, s]));
  const coefDe = (s: SalarieCout) => (s.centre_cout && e.coefParCc?.get(s.centre_cout)?.coef) || e.coef;
  const tauxDe = (s: SalarieCout) => tauxComplementsDe(e.complements, s.centre_cout);
  const pctCns = new Map<string, number>();
  e.cns.forEach((a) => pctCns.set(a.code_salarie, Math.min(100, nombre(a.pct_absenteisme))));
  const heuresInj = new Map<string, number>();
  e.injustifiees.forEach((a) => heuresInj.set(a.code_salarie, (heuresInj.get(a.code_salarie) ?? 0) + nombre(a.duree_hrs)));

  // ---- Payé contractuel par salarié, ventilé (base, compléments, injustifiées)
  const contractuel = new Map<string, { base: number; complements: number; injustifiees: number; paye: number }>();
  for (const s of e.photo) {
    const brut = e.source.brutDe(s.code_salarie);
    if (brut === null) continue;
    const { active, suspendue } = fractionsDuMois(s, e.mois, e.annee);
    const net = Math.max(0, active - suspendue);
    if (net <= 0 && !heuresInj.has(s.code_salarie)) continue;
    const coef = coefDe(s);
    const taux = tauxDe(s);
    const presence = 1 - (pctCns.get(s.code_salarie) ?? 0) / 100;
    const base = brut * etpDe(s) * coef * net * presence;
    const complements = base * taux;
    const injustifiees = e.heuresTravaillables > 0 ? ((heuresInj.get(s.code_salarie) ?? 0) / e.heuresTravaillables) * brut * (1 + taux) * coef : 0;
    contractuel.set(s.code_salarie, { base, complements, injustifiees, paye: base + complements - injustifiees });
  }
  const payeParSalarie = [...contractuel.values()].reduce((s, c) => s + c.paye, 0);

  // ---- Paie, ligne à ligne
  const acc: Record<CleReconciliation, { montant: number; codes: Set<string> }> = {
    variables: { montant: 0, codes: new Set() }, regularisations: { montant: 0, codes: new Set() },
    injustifiees_contractuel: { montant: 0, codes: new Set() }, soldes: { montant: 0, codes: new Set() },
    "compléments": { montant: 0, codes: new Set() }, brut_base: { montant: 0, codes: new Set() },
    avantages: { montant: 0, codes: new Set() }, charges: { montant: 0, codes: new Set() },
    hors_photo: { montant: 0, codes: new Set() }, sans_paie: { montant: 0, codes: new Set() }, methode: { montant: 0, codes: new Set() },
  };
  const ajouter = (cle: CleReconciliation, montant: number, code: string) => {
    if (montant === 0) return;
    acc[cle].montant += montant;
    acc[cle].codes.add(code);
  };
  const codesPayes = new Set<string>();

  for (const l of e.lignesPaie) {
    const code = l.code_salarie;
    const cout = nombre(l.cout_employeur);
    const totalBrut = nombre(l.total_brut);
    const avantages = nombre(l.avantages_nature);
    if (l.type_remuneration === "non_periodique") {
      ajouter("soldes", cout, code);
      continue;
    }
    codesPayes.add(code);
    const nat = ventilerNatures(l);
    const brutBase = nombre(l.brut_base);
    // Coût de la ligne = total brut × coefficient réel − avantages, à l'écart de charges près
    ajouter("charges", cout - (totalBrut * coefReel - avantages), code);
    ajouter("avantages", -avantages, code);
    ajouter("variables", (nat.variables + nat.soldes) * coefReel, code);
    ajouter("regularisations", nat.regularisations * coefReel, code);
    const c = contractuel.get(code);
    if (!c) {
      ajouter("hors_photo", (brutBase + nat.recurrents) * coefReel, code);
      continue;
    }
    ajouter("brut_base", brutBase * coefReel - c.base, code);
    ajouter("compléments", nat.recurrents * coefReel - c.complements, code);
    ajouter("injustifiees_contractuel", c.injustifiees, code);
  }
  // Sous contrat (payé > 0 dans le modèle) sans ligne de paie : le modèle les compte, la paie non
  contractuel.forEach((c, code) => {
    if (!codesPayes.has(code)) ajouter("sans_paie", -c.paye, code);
  });
  // Méthode : par identité, Σ des lignes ci-dessus = réalisé − payé par
  // salarié ; ce qui reste jusqu'à l'écart affiché est ce que la moyenne du
  // mois (payé de fin de mois mis à l'échelle de l'effectif moyen) fait
  // autrement que le salarié par salarié.
  acc.methode.montant = ecart - Object.entries(acc).filter(([k]) => k !== "methode").reduce((s, [, a]) => s + a.montant, 0);

  const ligne = (cle: CleReconciliation, libelle: string): LigneReconciliation => ({ cle, libelle, montant: acc[cle].montant, n: acc[cle].codes.size });
  const groupe = (titre: string, lignes: LigneReconciliation[]): GroupeReconciliation => ({ titre, lignes, montant: lignes.reduce((s, l) => s + l.montant, 0) });

  return {
    ecart,
    coefReel,
    payeParSalarie,
    groupes: [
      groupe("Ce que le contractuel ne modélise pas (variable)", [
        ligne("variables", "Suppléments variables (planning, primes, moyenne congé, avantages en brut), chargés"),
        ligne("regularisations", "Régularisations retenues en paie (absences injustifiées, congés trop pris), chargées"),
        ligne("injustifiees_contractuel", "Absences injustifiées retirées par le contractuel (la paie les retient ci-dessus)"),
        ligne("soldes", "Soldes de sortie (lignes non périodiques, coût employeur)"),
      ]),
      groupe("Écarts de structure des salaires", [
        ligne("brut_base", "Brut de base payé vs brut indice × ETP × présence (prorata, CNS, suspension), chargé"),
        ligne("compléments", "13e mois et prime de fonction réels vs taux du contractuel"),
        ligne("avantages", "Avantages en nature déduits du coût par la paie"),
        ligne("charges", "Charges réelles vs coefficient réel moyen (plafonds, régimes)"),
      ]),
      groupe("Périmètre et méthode", [
        ligne("hors_photo", "Payés en paie mais absents de la photo roster (sortis avant l'export)"),
        ligne("sans_paie", "Sous contrat dans le modèle sans ligne de paie"),
        ligne("methode", "Moyenne du mois à l'échelle vs calcul salarié par salarié"),
      ]),
    ],
  };
}
