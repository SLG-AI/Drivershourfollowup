/**
 * Amplitudes de service lues dans la paie : faute d'horaires de prise et de
 * fin de service, les seules traces sont les primes AM1 (amplitude > 11 h) et
 * AM2 (amplitude > 12 h) de la Liste des salaires, en euros par salarié et par
 * mois. On en tire combien de journées longues, chez qui, à quel coût — jamais
 * la durée réelle d'une journée.
 *
 * Journées : chaque prime est un montant fixe par journée (6,15 € puis 6,30 €
 * pour AM1, 9,48 € puis 9,72 € pour AM2 — indexation de juillet 2026). Le taux
 * du mois est le montant le plus fréquent, et le nombre de journées d'un
 * salarié est son montant divisé par ce taux, arrondi : un rappel d'indexation
 * (0,15 € par journée passée) arrondit ainsi à zéro au lieu de compter double.
 *
 * Les paliers sont EXCLUSIFS (constaté : des salariés touchent AM2 sans AM1) :
 * une journée longue est soit « 11 à 12 h » (AM1), soit « plus de 12 h » (AM2).
 *
 * Les primes ne concernent en pratique que les chauffeurs : la part des
 * concernés se rapporte aux chauffeurs payés du mois, pas à tout l'effectif.
 */

import { SEUIL_ANONYMAT, regrouperPetitsGroupes } from "./wp-anonymisation";

export interface LigneAmplitude {
  code_salarie: string;
  mois: number | string;
  fonction?: string | null;
  nat_am1?: unknown;
  nat_am2?: unknown;
}

/** Montant d'une journée pour chaque palier ; null si le mois n'en porte aucune. */
export interface TauxAmplitude {
  am1: number | null;
  am2: number | null;
}

export interface AgregatAmplitude {
  /** Salariés ayant au moins une journée longue. */
  concernes: number;
  /** Salariés ayant au moins une journée de 11 à 12 h. */
  concernesAm1: number;
  /** Salariés ayant au moins une journée de plus de 12 h. */
  concernesAm2: number;
  /** Chauffeurs payés : la base de la part des concernés. */
  chauffeurs: number;
  /** Journées de 11 à 12 h. */
  journeesAm1: number;
  /** Journées de plus de 12 h. */
  journeesAm2: number;
  am1: number;
  am2: number;
}

export interface AmplitudeMois extends AgregatAmplitude {
  mois: number;
  taux: TauxAmplitude;
}

export interface VentilationAmplitude extends AgregatAmplitude {
  cle: string;
}

export interface TrancheAmplitude {
  libelle: string;
  salaries: number;
}

const nombre = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function estChauffeur(fonction: string | null | undefined): boolean {
  return (fonction ?? "").trim().toUpperCase().startsWith("CHAUFFEUR");
}

/** Le montant positif le plus fréquent, au centime ; à égalité le plus petit. */
function modePositif(valeurs: number[]): number | null {
  const compte = new Map<number, number>();
  for (const v of valeurs) {
    if (v <= 0) continue;
    const c = Math.round(v * 100);
    compte.set(c, (compte.get(c) ?? 0) + 1);
  }
  let meilleur: [number, number] | null = null;
  for (const [c, n] of compte) {
    if (!meilleur || n > meilleur[1] || (n === meilleur[1] && c < meilleur[0])) meilleur = [c, n];
  }
  return meilleur ? meilleur[0] / 100 : null;
}

/** Taux d'une journée, lu sur les lignes d'UN mois. */
export function tauxDuMois(lignes: LigneAmplitude[]): TauxAmplitude {
  return {
    am1: modePositif(lignes.map((l) => nombre(l.nat_am1))),
    am2: modePositif(lignes.map((l) => nombre(l.nat_am2))),
  };
}

const journees = (montant: number, taux: number | null) =>
  taux && montant > 0 ? Math.round(montant / taux) : 0;

/**
 * Par salarié : un salarié peut avoir plusieurs lignes dans le mois (salaire
 * et non périodique), qui s'additionnent avant la conversion en journées.
 */
function parSalarie(lignes: LigneAmplitude[], taux: TauxAmplitude) {
  const montants = new Map<string, { am1: number; am2: number; chauffeur: boolean }>();
  for (const l of lignes) {
    const s = montants.get(l.code_salarie) ?? { am1: 0, am2: 0, chauffeur: false };
    s.am1 += nombre(l.nat_am1);
    s.am2 += nombre(l.nat_am2);
    s.chauffeur ||= estChauffeur(l.fonction);
    montants.set(l.code_salarie, s);
  }
  return [...montants.values()].map((s) => ({ ...s, j1: journees(s.am1, taux.am1), j2: journees(s.am2, taux.am2) }));
}

export function agregerAmplitudes(lignes: LigneAmplitude[], taux: TauxAmplitude): AgregatAmplitude {
  const agregat: AgregatAmplitude = { concernes: 0, concernesAm1: 0, concernesAm2: 0, chauffeurs: 0, journeesAm1: 0, journeesAm2: 0, am1: 0, am2: 0 };
  for (const s of parSalarie(lignes, taux)) {
    agregat.am1 += s.am1;
    agregat.am2 += s.am2;
    agregat.journeesAm1 += s.j1;
    agregat.journeesAm2 += s.j2;
    if (s.chauffeur) agregat.chauffeurs += 1;
    if (s.j1 > 0) agregat.concernesAm1 += 1;
    if (s.j2 > 0) agregat.concernesAm2 += 1;
    if (s.j1 + s.j2 > 0) agregat.concernes += 1;
  }
  return agregat;
}

/**
 * Les mois couverts par la paie, dans l'ordre. Le taux se lit sur TOUT le
 * mois (un périmètre filtré peut être trop petit pour le révéler), puis
 * l'agrégat se restreint au périmètre si `codes` est donné.
 */
export function amplitudesParMois(lignes: LigneAmplitude[], codes?: Set<string>): AmplitudeMois[] {
  const parMois = new Map<number, LigneAmplitude[]>();
  for (const l of lignes) {
    const m = Number(l.mois);
    parMois.set(m, [...(parMois.get(m) ?? []), l]);
  }
  return [...parMois.entries()]
    .sort(([a], [b]) => a - b)
    .map(([mois, ls]) => {
      const taux = tauxDuMois(ls);
      const perimetre = codes ? ls.filter((l) => codes.has(l.code_salarie)) : ls;
      return { mois, taux, ...agregerAmplitudes(perimetre, taux) };
    });
}

/**
 * Ventilation d'un mois (par dépôt, par fonction…). Sont restitués les
 * groupes qui ont des journées longues ou des chauffeurs — un dépôt sans
 * aucune journée longue vaut 0 par chauffeur, ce qui compte pour comparer.
 * Les groupes de 1 ou 2 concernés sont fondus en « Autres » pour qu'aucune
 * prime individuelle ne se lise ; un groupe à 0 concerné ne révèle rien et
 * reste seul dès qu'il compte au moins 3 chauffeurs.
 */
export function ventilerAmplitudes(
  lignes: LigneAmplitude[],
  taux: TauxAmplitude,
  cleDe: (l: LigneAmplitude) => string | null | undefined,
  sansCle: string,
  libelleAutres: string
): VentilationAmplitude[] {
  const groupes = new Map<string, LigneAmplitude[]>();
  for (const l of lignes) {
    const k = cleDe(l) || sansCle;
    groupes.set(k, [...(groupes.get(k) ?? []), l]);
  }
  const ventilation = [...groupes.entries()]
    .map(([cle, ls]) => ({ cle, ...agregerAmplitudes(ls, taux) }))
    .filter((g) => g.concernes > 0 || g.chauffeurs > 0)
    .sort((a, b) => b.journeesAm1 + b.journeesAm2 - (a.journeesAm1 + a.journeesAm2));
  const taille = (g: VentilationAmplitude) => (g.concernes === 0 && g.chauffeurs >= SEUIL_ANONYMAT ? SEUIL_ANONYMAT : g.concernes);
  const somme = (gs: VentilationAmplitude[], k: keyof AgregatAmplitude) => gs.reduce((s, g) => s + g[k], 0);
  return regrouperPetitsGroupes(ventilation, taille, (petits) => ({
    cle: `${libelleAutres} (${petits.length})`,
    concernes: somme(petits, "concernes"),
    concernesAm1: somme(petits, "concernesAm1"),
    concernesAm2: somme(petits, "concernesAm2"),
    chauffeurs: somme(petits, "chauffeurs"),
    journeesAm1: somme(petits, "journeesAm1"),
    journeesAm2: somme(petits, "journeesAm2"),
    am1: somme(petits, "am1"),
    am2: somme(petits, "am2"),
  }));
}

/** Bornes basses des tranches de journées longues par salarié ; la dernière est ouverte. */
export const TRANCHES_JOURNEES = [1, 2, 3, 4, 6, 10] as const;

/**
 * Répartition des salariés concernés selon leur nombre de journées longues
 * dans le mois (11 à 12 h et plus de 12 h confondues) : quelques journées
 * isolées ou un rythme installé.
 */
export function tranchesParJournees(lignes: LigneAmplitude[], taux: TauxAmplitude): TrancheAmplitude[] {
  const tranches = TRANCHES_JOURNEES.map((bas, i) => {
    const suivant = TRANCHES_JOURNEES[i + 1];
    const libelle = suivant === undefined ? `${bas} et +` : suivant - bas === 1 ? `${bas}` : `${bas} à ${suivant - 1}`;
    return { libelle, salaries: 0 };
  });
  for (const s of parSalarie(lignes, taux)) {
    const total = s.j1 + s.j2;
    if (total <= 0) continue;
    let i = TRANCHES_JOURNEES.length - 1;
    while (i > 0 && total < TRANCHES_JOURNEES[i]) i--;
    tranches[i].salaries += 1;
  }
  return tranches;
}
