/**
 * Jours supplémentaires de travail (« 6e jours ») lus dans la paie : la prime
 * PRR de la Liste des salaires, 80 € le jour (PRIME_6E_JOUR), réglée sur la
 * paie qui SUIT la fin de chaque période de référence — janvier pour sept.–déc.,
 * mai pour janv.–avr., septembre pour mai–août. Quelques rattrapages tombent
 * les mois suivants : ils sont rattachés à la même période.
 *
 * Le nombre de jours d'un salarié est son montant de la période divisé par
 * 80 €, arrondi (ses lignes additionnées : une régularisation négative annule).
 */

import { PERIODS } from "@/lib/constants";
import { SEUIL_ANONYMAT, regrouperPetitsGroupes } from "./wp-anonymisation";
import { estChauffeur } from "./wp-amplitudes";
import { PRIME_6E_JOUR } from "./wp-variable-attendu";

export interface LigneSixiemeJour {
  code_salarie: string;
  mois: number | string;
  annee: number | string;
  fonction?: string | null;
  nat_prr?: unknown;
}

export interface PeriodeReglee {
  annee: number;
  numero: number;
}

export interface AgregatSixiemesJours {
  /** Salariés ayant au moins un jour supplémentaire payé. */
  concernes: number;
  /** Chauffeurs payés au mois de paie principal : base des taux par chauffeur. */
  chauffeurs: number;
  jours: number;
  montant: number;
}

export interface SixiemesJoursPeriode extends AgregatSixiemesJours, PeriodeReglee {
  /** « P1 2026 (janv.–avr.) » */
  libelle: string;
  /** Mois de paie principal (le plus gros règlement), sur lequel se lit la base. */
  moisPaie: number;
  anneePaie: number;
}

export interface VentilationSixiemesJours extends AgregatSixiemesJours {
  cle: string;
}

export interface TrancheSixiemesJours {
  libelle: string;
  salaries: number;
}

const nombre = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const MOIS_COURTS = ["", "janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** La dernière période close avant le mois de paie : celle que la paie règle. */
export function periodeRegleeParLaPaie(moisPaie: number, anneePaie: number): PeriodeReglee {
  if (moisPaie <= 4) return { annee: anneePaie - 1, numero: 3 };
  if (moisPaie <= 8) return { annee: anneePaie, numero: 1 };
  return { annee: anneePaie, numero: 2 };
}

export function libellePeriode(p: PeriodeReglee): string {
  const def = PERIODS.find((d) => d.number === p.numero);
  return def ? `P${p.numero} ${p.annee} (${MOIS_COURTS[def.startMonth]}–${MOIS_COURTS[def.endMonth]})` : `P${p.numero} ${p.annee}`;
}

/** Dernier mois d'activité de la période (avril, août ou décembre). */
export function moisFinPeriode(p: PeriodeReglee): number {
  return PERIODS.find((d) => d.number === p.numero)?.endMonth ?? 12;
}

const cle = (p: PeriodeReglee) => `${p.annee}-${p.numero}`;

export function joursParSalarie(lignes: LigneSixiemeJour[]): Map<string, { jours: number; montant: number }> {
  const montants = new Map<string, number>();
  for (const l of lignes) montants.set(l.code_salarie, (montants.get(l.code_salarie) ?? 0) + nombre(l.nat_prr));
  const res = new Map<string, { jours: number; montant: number }>();
  for (const [code, montant] of montants) res.set(code, { montant, jours: montant > 0 ? Math.round(montant / PRIME_6E_JOUR) : 0 });
  return res;
}

/** Mois de paie où se compte la base des chauffeurs : celui du plus gros règlement de la période. */
export interface MoisPaie {
  mois: number;
  annee: number;
}

/**
 * Les chauffeurs se comptent sur le seul mois de paie principal (sinon un
 * chauffeur payé en janvier et en février compterait deux fois) ; sans mois
 * principal, sur toutes les lignes.
 */
export function agregerSixiemesJours(lignes: LigneSixiemeJour[], principal?: MoisPaie): AgregatSixiemesJours {
  const a: AgregatSixiemesJours = { concernes: 0, chauffeurs: 0, jours: 0, montant: 0 };
  for (const s of joursParSalarie(lignes).values()) {
    a.montant += s.montant;
    a.jours += s.jours;
    if (s.jours > 0) a.concernes += 1;
  }
  a.chauffeurs = new Set(
    lignes
      .filter((l) => estChauffeur(l.fonction) && (!principal || (Number(l.mois) === principal.mois && Number(l.annee) === principal.annee)))
      .map((l) => l.code_salarie)
  ).size;
  return a;
}

/** Les lignes PRR de la période réglée `p`, quel que soit leur mois de paie. */
export function lignesDeLaPeriode(lignes: LigneSixiemeJour[], p: PeriodeReglee): LigneSixiemeJour[] {
  const k = cle(p);
  return lignes.filter((l) => cle(periodeRegleeParLaPaie(Number(l.mois), Number(l.annee))) === k);
}

/**
 * Une entrée par période réglée qui porte des jours, dans l'ordre. `lignes`
 * contient toute la paie (pas seulement les lignes PRR) : la base des
 * chauffeurs payés se lit au mois de paie principal. Le périmètre `codes`
 * restreint concernés ET base.
 */
export function sixiemesJoursParPeriode(lignes: LigneSixiemeJour[], codes?: Set<string>): SixiemesJoursPeriode[] {
  const perimetre = codes ? lignes.filter((l) => codes.has(l.code_salarie)) : lignes;
  const parPeriode = new Map<string, { p: PeriodeReglee; lignes: LigneSixiemeJour[] }>();
  for (const l of perimetre) {
    if (nombre(l.nat_prr) === 0) continue;
    const p = periodeRegleeParLaPaie(Number(l.mois), Number(l.annee));
    const g = parPeriode.get(cle(p)) ?? { p, lignes: [] };
    g.lignes.push(l);
    parPeriode.set(cle(p), g);
  }
  return [...parPeriode.values()]
    .map(({ p, lignes: ls }) => {
      const parMoisPaie = new Map<string, { mois: number; annee: number; montant: number }>();
      for (const l of ls) {
        const k = `${l.annee}-${l.mois}`;
        const m = parMoisPaie.get(k) ?? { mois: Number(l.mois), annee: Number(l.annee), montant: 0 };
        m.montant += nombre(l.nat_prr);
        parMoisPaie.set(k, m);
      }
      const principal = [...parMoisPaie.values()].reduce((a, b) => (b.montant > a.montant ? b : a));
      const agregat = agregerSixiemesJours(ls);
      const chauffeurs = agregerSixiemesJours(perimetre.filter((l) => Number(l.mois) === principal.mois && Number(l.annee) === principal.annee)).chauffeurs;
      return { ...p, libelle: libellePeriode(p), moisPaie: principal.mois, anneePaie: principal.annee, ...agregat, chauffeurs };
    })
    .filter((p) => p.concernes > 0)
    .sort((a, b) => a.annee - b.annee || a.numero - b.numero);
}

/**
 * Ventilation d'une période (par dépôt, par fonction). `lignes` : toute la
 * paie de la période, pour que les groupes sans jour supplémentaire gardent
 * leurs chauffeurs (0 par chauffeur compte pour comparer). Les groupes de 1 ou
 * 2 concernés sont fondus en « Autres » ; un groupe à 0 concerné ne révèle
 * rien et reste seul dès qu'il compte au moins 3 chauffeurs.
 */
export function ventilerSixiemesJours(
  lignes: LigneSixiemeJour[],
  principal: MoisPaie,
  cleDe: (l: LigneSixiemeJour) => string | null | undefined,
  sansCle: string,
  libelleAutres: string
): VentilationSixiemesJours[] {
  const groupes = new Map<string, LigneSixiemeJour[]>();
  for (const l of lignes) {
    const k = cleDe(l) || sansCle;
    groupes.set(k, [...(groupes.get(k) ?? []), l]);
  }
  const ventilation = [...groupes.entries()]
    .map(([k, ls]) => ({ cle: k, ...agregerSixiemesJours(ls, principal) }))
    .filter((g) => g.concernes > 0 || g.chauffeurs > 0)
    .sort((a, b) => b.jours - a.jours);
  const taille = (g: VentilationSixiemesJours) => (g.concernes === 0 && g.chauffeurs >= SEUIL_ANONYMAT ? SEUIL_ANONYMAT : g.concernes);
  return regrouperPetitsGroupes(ventilation, taille, (petits) => ({
    cle: `${libelleAutres} (${petits.length})`,
    concernes: petits.reduce((s, g) => s + g.concernes, 0),
    chauffeurs: petits.reduce((s, g) => s + g.chauffeurs, 0),
    jours: petits.reduce((s, g) => s + g.jours, 0),
    montant: petits.reduce((s, g) => s + g.montant, 0),
  }));
}

/** Bornes basses des tranches de jours par salarié sur la période ; la dernière est ouverte. */
export const TRANCHES_SIXIEMES_JOURS = [1, 2, 3, 4, 6, 8] as const;

export function tranchesSixiemesJours(lignes: LigneSixiemeJour[]): TrancheSixiemesJours[] {
  const tranches = TRANCHES_SIXIEMES_JOURS.map((bas, i) => {
    const suivant = TRANCHES_SIXIEMES_JOURS[i + 1];
    const libelle = suivant === undefined ? `${bas} et +` : suivant - bas === 1 ? `${bas}` : `${bas} à ${suivant - 1}`;
    return { libelle, salaries: 0 };
  });
  for (const s of joursParSalarie(lignes).values()) {
    if (s.jours <= 0) continue;
    let i = TRANCHES_SIXIEMES_JOURS.length - 1;
    while (i > 0 && s.jours < TRANCHES_SIXIEMES_JOURS[i]) i--;
    tranches[i].salaries += 1;
  }
  return tranches;
}
