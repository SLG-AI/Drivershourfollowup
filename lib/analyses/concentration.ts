/**
 * Concentration d'une charge (journées longues, jours supplémentaires…) sur
 * une population de chauffeurs : la moyenne ne dit pas si tout le monde en
 * fait un peu ou si quelques-uns en font beaucoup.
 *
 * Ne sortent d'ici que des AGRÉGATS, et chacun seulement au-delà d'un
 * effectif qui empêche d'y lire une personne (arbitrage du 13/10/2026 : rien
 * d'individuel, même pseudonymisé, ne part vers l'API d'analyse) :
 *  - tout le groupe : au moins SEUIL_ANONYMAT (3) chauffeurs ;
 *  - médiane et 90e centile : au moins 10 (une valeur d'ordre EST la valeur
 *    d'une personne, noyée seulement dans un groupe assez grand) ;
 *  - part du top 20 % : au moins 15 (top de 3 personnes ou plus) ;
 *  - part du top 10 % et moyennes par décile : au moins 30 (déciles de 3).
 * En dessous, la mesure vaut null — jamais une valeur approchée.
 */

import { SEUIL_ANONYMAT, regrouperPetitsGroupes } from "@/lib/utils/wp-anonymisation";

export const EFFECTIF_MIN_QUANTILES = 10;
export const EFFECTIF_MIN_TOP20 = 15;
export const EFFECTIF_MIN_DECILES = 30;

export interface Concentration {
  /** Chauffeurs de la population, y compris ceux à zéro. */
  effectif: number;
  total: number;
  moyenne: number;
  /** Chauffeurs ayant une valeur strictement positive. */
  concernes: number;
  mediane: number | null;
  p90: number | null;
  /** Part du total portée par les 10 % / 20 % les plus chargés (0–1). */
  partTop10: number | null;
  partTop20: number | null;
  /** 0 = charge également répartie, → 1 = toute sur une personne. */
  gini: number;
  /** Moyenne de chaque décile, du moins au plus chargé (10 valeurs). */
  moyennesDeciles: number[] | null;
  /** Chauffeurs au-delà du seuil, si un seuil est donné. */
  auDelaDuSeuil: { seuil: number; chauffeurs: number } | null;
}

export interface ConcentrationGroupe extends Concentration {
  cle: string;
}

export interface ValeurChauffeur {
  code_salarie: string;
  valeur: number;
}

/** Quantile par interpolation linéaire sur valeurs triées croissantes. */
function quantile(tries: number[], q: number): number {
  const pos = (tries.length - 1) * q;
  const bas = Math.floor(pos);
  const haut = Math.ceil(pos);
  return tries[bas] + (tries[haut] - tries[bas]) * (pos - bas);
}

/** Part du total portée par les `part` (0–1) plus chargés, arrondie à la personne. */
function partDuTop(tries: number[], total: number, part: number): number {
  if (total <= 0) return 0;
  const n = Math.max(1, Math.round(tries.length * part));
  return tries.slice(-n).reduce((s, v) => s + v, 0) / total;
}

/** Gini par la formule triée : Σ (2i − n − 1) xᵢ / (n Σ xᵢ). */
function gini(tries: number[], total: number): number {
  const n = tries.length;
  if (n === 0 || total <= 0) return 0;
  let s = 0;
  tries.forEach((x, i) => { s += (2 * (i + 1) - n - 1) * x; });
  return s / (n * total);
}

/** Null sous SEUIL_ANONYMAT : un groupe trop petit ne se mesure pas. */
export function mesurerConcentration(valeurs: number[], seuil?: number): Concentration | null {
  if (valeurs.length < SEUIL_ANONYMAT) return null;
  const tries = valeurs.map((v) => Math.max(0, v)).sort((a, b) => a - b);
  const effectif = tries.length;
  const total = tries.reduce((s, v) => s + v, 0);
  const deciles = effectif >= EFFECTIF_MIN_DECILES
    ? Array.from({ length: 10 }, (_, d) => {
      const tranche = tries.slice(Math.floor((effectif * d) / 10), Math.floor((effectif * (d + 1)) / 10));
      return tranche.reduce((s, v) => s + v, 0) / tranche.length;
    })
    : null;
  return {
    effectif,
    total,
    moyenne: total / effectif,
    concernes: tries.filter((v) => v > 0).length,
    mediane: effectif >= EFFECTIF_MIN_QUANTILES ? quantile(tries, 0.5) : null,
    p90: effectif >= EFFECTIF_MIN_QUANTILES ? quantile(tries, 0.9) : null,
    partTop10: effectif >= EFFECTIF_MIN_DECILES ? partDuTop(tries, total, 0.1) : null,
    partTop20: effectif >= EFFECTIF_MIN_TOP20 ? partDuTop(tries, total, 0.2) : null,
    gini: gini(tries, total),
    moyennesDeciles: deciles,
    auDelaDuSeuil: seuil == null ? null : { seuil, chauffeurs: tries.filter((v) => v >= seuil).length },
  };
}

/**
 * Concentration par groupe (dépôt…). Les groupes de moins de 3 chauffeurs
 * sont fondus en « Autres » AVANT la mesure, pour qu'aucun ne disparaisse
 * des totaux ni ne se lise seul.
 */
export function concentrationParGroupe(
  valeurs: ValeurChauffeur[],
  groupeDe: (code: string) => string | null | undefined,
  sansGroupe: string,
  libelleAutres: string,
  seuil?: number
): ConcentrationGroupe[] {
  const groupes = new Map<string, number[]>();
  for (const v of valeurs) {
    const k = groupeDe(v.code_salarie) || sansGroupe;
    groupes.set(k, [...(groupes.get(k) ?? []), v.valeur]);
  }
  const bruts = [...groupes.entries()].map(([cle, vs]) => ({ cle, vs }));
  const regroupes = regrouperPetitsGroupes(bruts, (g) => g.vs.length, (petits) => ({
    cle: `${libelleAutres} (${petits.length})`,
    vs: petits.flatMap((g) => g.vs),
  }));
  return regroupes
    .map((g) => {
      const c = mesurerConcentration(g.vs, seuil);
      return c ? { cle: g.cle, ...c } : null;
    })
    .filter((g): g is ConcentrationGroupe => g !== null)
    .sort((a, b) => b.moyenne - a.moyenne);
}

export interface Recurrence {
  /** Taille du top retenu sur chaque période. */
  tailleTop: number;
  /** Combien du top courant étaient déjà dans le top de la période précédente. */
  dejaDansLeTop: number;
  /** dejaDansLeTop / tailleTop ; un tirage au hasard donnerait ≈ `part`. */
  taux: number;
}

/**
 * Les plus chargés sont-ils toujours les mêmes ? Compare le top `part` (10 %
 * par défaut) de deux périodes, sur les chauffeurs présents aux deux. Null si
 * le top compte moins de 3 personnes.
 */
export function recurrenceDuTop(precedent: ValeurChauffeur[], courant: ValeurChauffeur[], part = 0.1): Recurrence | null {
  const avant = new Map(precedent.map((v) => [v.code_salarie, v.valeur]));
  const communs = courant.filter((v) => avant.has(v.code_salarie));
  const tailleTop = Math.round(communs.length * part);
  if (tailleTop < SEUIL_ANONYMAT) return null;
  const top = (vs: ValeurChauffeur[]) => new Set(
    [...vs].sort((a, b) => b.valeur - a.valeur).slice(0, tailleTop).filter((v) => v.valeur > 0).map((v) => v.code_salarie)
  );
  const topAvant = top(communs.map((v) => ({ code_salarie: v.code_salarie, valeur: avant.get(v.code_salarie) ?? 0 })));
  const topCourant = top(communs);
  const dejaDansLeTop = [...topCourant].filter((c) => topAvant.has(c)).length;
  return { tailleTop, dejaDansLeTop, taux: dejaDansLeTop / tailleTop };
}
