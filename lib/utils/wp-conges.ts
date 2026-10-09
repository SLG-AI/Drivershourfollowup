/**
 * Congés pris, lus dans l'export MCT et rangés dans `wp_conges`.
 *
 * RÈGLES (arbitrées le 2026-10-09) :
 *  - CONGES = congés ; CDEMEN / CGDEC / CNOCES / RECUP = congés
 *    extraordinaires et récupération. Les deux sont retirés de l'effectif
 *    « après MCT » pour donner le disponible ; aucun n'est de l'absentéisme
 *    (le taux global ne les compte pas).
 *  - Mesuré ou rien : les congés sont saisonniers, un mois sans fichier ne
 *    reprend JAMAIS le taux d'un autre mois.
 *  - Les congés des chauffeurs arrivent plus tard dans le mois que ceux des
 *    services supports. Un mois n'est COMPLET que si son import MCT le plus
 *    récent a été marqué « contient les congés des chauffeurs » ; sinon ses
 *    congés sont partiels et se tracent en pointillé.
 *  - Mêmes conversions que le MCT : week-ends écartés, heures / heures
 *    travaillables du mois.
 */

import { estJourDeWeekEnd, getWorkableHoursInMonth } from "./wp-calculations";
import type { LigneHeures } from "./wp-paliers";

export type CategorieConge = "conges" | "extraordinaire";

export interface LigneConge extends LigneHeures {
  categorie: CategorieConge | string;
  date_conge?: string | null;
  prestation?: string | null;
  nom_salarie?: string | null;
  equipe?: string | null;
}

/** Libellés des codes de congé, pour le détail. */
export const LIBELLES_PRESTATION_CONGE: Record<string, string> = {
  CONGES: "Congés",
  CDEMEN: "Déménagement",
  CGDEC: "Congé décès",
  CNOCES: "Noces",
  RECUP: "Récupération",
};

/** Colonnes lues par les pages (jamais de motif : il n'est pas stocké). */
export const COLONNES_CONGES = "code_salarie, nom_salarie, equipe, prestation, categorie, date_conge, duree_hrs, mois, annee";

export function congesHorsWeekEnd<T extends { date_conge?: string | null }>(lignes: T[]): T[] {
  return lignes.filter((l) => !estJourDeWeekEnd(l.date_conge));
}

/**
 * Mois COMPLETS d'une année : ceux dont l'import MCT le plus récent (terminé)
 * porte le drapeau « congés des chauffeurs ». `imports` = lignes de
 * `wp_imports` de type absences_mct, statut completed, avec mois/annee.
 */
export function moisCongesComplets(
  imports: { mois?: number | string | null; annee?: number | string | null; imported_at?: string | null; conges_chauffeurs_inclus?: boolean | null }[],
  annee: number
): Set<number> {
  const dernier = new Map<number, { quand: string; complet: boolean }>();
  imports.forEach((i) => {
    if (Number(i.annee) !== annee || !i.mois) return;
    const m = Number(i.mois);
    const quand = String(i.imported_at ?? "");
    const prec = dernier.get(m);
    if (!prec || quand > prec.quand) dernier.set(m, { quand, complet: i.conges_chauffeurs_inclus === true });
  });
  return new Set([...dernier].filter(([, v]) => v.complet).map(([m]) => m));
}

export interface CongesDuMois {
  heuresConges: number;
  heuresExtra: number;
  etpConges: number;
  etpExtra: number;
  /** Le mois porte au moins une ligne de congé. */
  mesure: boolean;
  /** Congés complets (chauffeurs importés). */
  complet: boolean;
}

/**
 * Congés d'un mois convertis en ETP. `lignes` doit être hors week-end ;
 * `codes`, s'il est non vide, restreint aux salariés de la photo du mois
 * (même règle que le MCT).
 */
export function congesDuMois(
  lignes: LigneConge[],
  mois: number,
  annee: number,
  codes: Set<string>,
  complets: Set<number>
): CongesDuMois {
  const duMois = lignes.filter((l) => Number(l.mois) === mois && (codes.size === 0 || codes.has(l.code_salarie)));
  const heures = (cat: CategorieConge) =>
    duMois.filter((l) => l.categorie === cat).reduce((s, l) => s + Number(l.duree_hrs || 0), 0);
  const heuresConges = heures("conges");
  const heuresExtra = heures("extraordinaire");
  const travaillables = getWorkableHoursInMonth(annee, mois);
  return {
    heuresConges,
    heuresExtra,
    etpConges: travaillables > 0 ? heuresConges / travaillables : 0,
    etpExtra: travaillables > 0 ? heuresExtra / travaillables : 0,
    mesure: duMois.length > 0,
    complet: complets.has(mois),
  };
}
