/**
 * Mouvements d'effectif entre deux photographies de roster.
 *
 * L'export SIRH ne reconduit pas les salariés déjà sortis à la date de
 * l'export : lire les dates de sortie dans la seule photo du mois affiché fait
 * donc disparaître les sortis du mois. La seule source fiable est la
 * COMPARAISON de deux photographies consécutives (mois précédent, mois
 * affiché) : qui est apparu, qui a disparu, qui est passé en sortie
 * temporaire, qui en est revenu.
 *
 * Convention partagée avec le moteur de scénarios : une sortie (ou un retour)
 * datée du DERNIER jour d'un mois prend effet le mois suivant.
 */

import { isTempExitAt, lastDayOfMonth } from "./wp-calculations";
import { fractionSuspendue, fractionSuspendueEmploye } from "./wp-suspension";

export interface MovementEmployee {
  code_salarie: string;
  nom_salarie?: string | null;
  vehicle_type?: string | null;
  description_equipe?: string | null;
  date_entree?: string | null;
  date_sortie?: string | null;
  est_sortie_temporaire?: boolean | null;
  date_debut_sortie_temporaire?: string | null;
  date_fin_sortie_temporaire?: string | null;
  description_motif_sortie?: string | null;
  taux_occupation?: number | null;
}

export interface MovementItem {
  code_salarie: string;
  nom_salarie: string | null;
  vehicle_type: string;
  description_equipe: string;
  /** Date du mouvement (ISO), ou null quand elle est inconnue (anomalie). */
  date: string | null;
  motif: string;
  /** ETP du salarié (taux d'occupation / 100) dans la photo qui porte le mouvement. */
  etp: number;
  /** Changement de temps de travail uniquement : taux avant / après et variation en ETP. */
  tauxAvant?: number;
  tauxApres?: number;
  deltaEtp?: number;
  /**
   * Sorties uniquement : ETP que le salarié avait déjà en suspension de
   * contrat à la fin du mois précédent (0 s'il travaillait). Cette part ne
   * comptait plus dans l'effectif net : sa sortie ne le change pas.
   */
  etpSuspenduAvant?: number;
}

export interface SortieConstatee {
  date: string;
  motif?: string;
}

export interface RosterMovements {
  nouveaux: MovementItem[];
  sortiesDefinitives: MovementItem[];
  sortiesTemporaires: MovementItem[];
  retours: MovementItem[];
  /**
   * Disparus du roster avant leur date de sortie prévue (ou sans date), et
   * qu'aucune autre source ne date. `date` porte alors la date PRÉVUE.
   */
  disparusSansDate: MovementItem[];
  /** Présents dans les deux photos avec un taux d'occupation différent. */
  changementsTemps: MovementItem[];
}

// Règle de reclassification déplacée dans wp-suspension.ts (le moteur de
// projection en a besoin sans importer ce module, qui dépend de lui).
export { isCongeStructurel, reclassifierSortiesTemporaires } from "./wp-suspension";

/** Rang absolu d'un mois, pour comparer des périodes. */
function rang(annee: number, mois: number): number {
  return annee * 12 + mois;
}

/**
 * Mois de prise d'effet d'une date de sortie ou de retour : le mois de la
 * date, sauf si elle tombe le dernier jour du mois, auquel cas le suivant.
 * Retourne un rang (annee * 12 + mois), ou null si la date est absente.
 */
export function rangEffectif(date: string | null | undefined): number | null {
  if (!date) return null;
  const iso = date.slice(0, 10);
  const annee = Number(iso.slice(0, 4));
  const mois = Number(iso.slice(5, 7));
  if (!annee || !mois) return null;
  const r = rang(annee, mois);
  return iso === lastDayOfMonth(annee, mois) ? r + 1 : r;
}

/** Rang du mois d'une date, sans règle du dernier jour. */
function rangCalendaire(date: string | null | undefined): number | null {
  if (!date) return null;
  const annee = Number(date.slice(0, 4));
  const mois = Number(date.slice(5, 7));
  if (!annee || !mois) return null;
  return rang(annee, mois);
}

function etpOf(e: MovementEmployee): number {
  const taux = Number(e.taux_occupation);
  return Number.isFinite(taux) && e.taux_occupation !== null && e.taux_occupation !== undefined ? taux / 100 : 1;
}

function toItem(e: MovementEmployee, date: string | null): MovementItem {
  return {
    code_salarie: e.code_salarie,
    nom_salarie: e.nom_salarie || null,
    vehicle_type: e.vehicle_type || "?",
    description_equipe: e.description_equipe || "",
    date,
    motif: e.description_motif_sortie || "",
    etp: etpOf(e),
  };
}

/** ETP en suspension de contrat à une date (règle `isTempExitAt`, fraction suspendue appliquée). */
function etpSuspenduLe(e: MovementEmployee, date: string): number {
  const temp = isTempExitAt({ ...e, est_sortie_temporaire: !!e.est_sortie_temporaire }, date);
  return temp ? etpOf(e) * fractionSuspendueEmploye(e) : 0;
}

function byDate(a: MovementItem, b: MovementItem): number {
  return (a.date || "9999").localeCompare(b.date || "9999");
}

/**
 * Mouvements survenus entre la photographie `prev` (mois précédent) et la
 * photographie `curr` (mois affiché, `mois`/`annee`).
 *
 * Les deux listes doivent avoir subi la même reclassification et les mêmes
 * filtres d'affichage.
 */
export function computeRosterMovements(
  prev: MovementEmployee[],
  curr: MovementEmployee[],
  mois: number,
  annee: number,
  /**
   * Sorties CONSTATÉES par une autre source (export IN/OUT du SIRH, à défaut
   * statistiques salariales), par code salarié. Un CDD arrêté avant son terme
   * disparaît du roster alors que la photo précédente ne connaît que la date
   * prévue ; la source constatée apporte la date réelle et, si elle l'a, le motif.
   */
  sortiesConstatees: Map<string, SortieConstatee> = new Map()
): RosterMovements {
  const M = rang(annee, mois);
  const finMoisPrecedent = mois === 1 ? lastDayOfMonth(annee - 1, 12) : lastDayOfMonth(annee, mois - 1);
  const prevByCode = new Map(prev.map((e) => [e.code_salarie, e]));
  const currByCode = new Map(curr.map((e) => [e.code_salarie, e]));

  const nouveaux: MovementItem[] = [];
  const sortiesDefinitives: MovementItem[] = [];
  const sortiesTemporaires: MovementItem[] = [];
  const retours: MovementItem[] = [];
  const disparusSansDate: MovementItem[] = [];
  const changementsTemps: MovementItem[] = [];

  // Apparus : présents ce mois, absents le mois précédent.
  for (const e of curr) {
    if (!prevByCode.has(e.code_salarie)) nouveaux.push(toItem(e, e.date_entree || null));
  }

  // Disparus : présents le mois précédent, absents ce mois.
  for (const e of prev) {
    if (currByCode.has(e.code_salarie)) continue;

    const r = rangEffectif(e.date_sortie);
    // Déjà comptée dans les mouvements d'un mois antérieur.
    if (r !== null && r < M) continue;

    // Une sortie constatée ailleurs prime sur la date prévue : le salarié a
    // bel et bien quitté le roster, on le date de sa sortie réelle.
    const constatee = sortiesConstatees.get(e.code_salarie);
    const rc = rangEffectif(constatee?.date);
    const etpSuspenduAvant = etpSuspenduLe(e, finMoisPrecedent);
    if (constatee && rc !== null && rc <= M) {
      sortiesDefinitives.push({
        ...toItem(e, constatee.date),
        motif: constatee.motif || e.description_motif_sortie || "",
        etpSuspenduAvant,
      });
    } else if (r === M) {
      // Sortie effective ce mois, quel que soit le drapeau : le SIRH l'a retiré.
      sortiesDefinitives.push({ ...toItem(e, e.date_sortie!), etpSuspenduAvant });
    } else {
      disparusSansDate.push({ ...toItem(e, e.date_sortie || null), etpSuspenduAvant });
    }
  }

  for (const e of curr) {
    const p = prevByCode.get(e.code_salarie);

    // Changement de temps de travail : présent dans les deux photos avec un
    // taux différent. Invisible en têtes, réel en ETP.
    if (p) {
      const avant = etpOf(p);
      const apres = etpOf(e);
      if (Math.abs(apres - avant) > 1e-9) {
        changementsTemps.push({
          ...toItem(e, null),
          tauxAvant: Math.round(avant * 1000) / 10,
          tauxApres: Math.round(apres * 1000) / 10,
          deltaEtp: Math.round((apres - avant) * 1000) / 1000,
        });
      }
    }

    // Toujours présent mais sorti définitivement ce mois (date avant la fin
    // du mois, hors sortie temporaire) : la courbe l'exclut déjà du point.
    if (!e.est_sortie_temporaire && rangEffectif(e.date_sortie) === M) {
      const etpSuspenduAvant = p ? etpSuspenduLe(p, finMoisPrecedent) : 0;
      sortiesDefinitives.push({ ...toItem(e, e.date_sortie!), etpSuspenduAvant });
    }

    // Passage en sortie temporaire ce mois.
    if (e.est_sortie_temporaire && rangCalendaire(e.date_debut_sortie_temporaire) === M) {
      // ETP réellement retiré : la fraction suspendue (0.5 pour un temps partiel)
      sortiesTemporaires.push({
        ...toItem(e, e.date_debut_sortie_temporaire!),
        etp: etpOf(e) * fractionSuspendueEmploye(e),
      });
    }

    // Retour de sortie temporaire. L'export du mois de retour efface souvent
    // les dates : on lit d'abord la photo précédente, qui les portait encore.
    const source = p && p.est_sortie_temporaire && p.date_fin_sortie_temporaire ? p : e;
    if (
      source.est_sortie_temporaire &&
      rangEffectif(source.date_fin_sortie_temporaire) === M
    ) {
      const motif = source.description_motif_sortie || e.description_motif_sortie || "";
      retours.push({
        ...toItem(e, source.date_fin_sortie_temporaire!),
        motif,
        etp: etpOf(e) * fractionSuspendue(motif),
      });
    }
  }

  return {
    nouveaux: nouveaux.sort(byDate),
    sortiesDefinitives: sortiesDefinitives.sort(byDate),
    sortiesTemporaires: sortiesTemporaires.sort(byDate),
    retours: retours.sort(byDate),
    disparusSansDate: disparusSansDate.sort(byDate),
    // Baisses d'abord (les plus fortes en tête), puis hausses.
    changementsTemps: changementsTemps.sort((a, b) => (a.deltaEtp ?? 0) - (b.deltaEtp ?? 0)),
  };
}

export interface SoldeEtp {
  /** Variation de l'effectif SOUS CONTRAT : nouveaux − sorties définitives − disparus + changements de temps. */
  sousContrat: number;
  /**
   * Variation de l'effectif NET (après suspensions) : le solde sous contrat,
   * plus les retours, moins les suspensions (à hauteur de la fraction
   * suspendue), sans la part déjà suspendue des salariés sortis (elle ne
   * comptait plus dans le net).
   */
  net: number;
}

/** Soldes en ETP d'un ensemble de mouvements, rapprochables des deux premiers KPI. */
export function soldeEtp(m: RosterMovements): SoldeEtp {
  const somme = (items: MovementItem[]) => items.reduce((s, i) => s + i.etp, 0);
  const arrondi = (n: number) => Math.round(n * 100) / 100;
  const sortiesSousContrat = somme(m.sortiesDefinitives) + somme(m.disparusSansDate);
  const sortiesDejaSuspendues = [...m.sortiesDefinitives, ...m.disparusSansDate].reduce(
    (s, i) => s + (i.etpSuspenduAvant ?? 0),
    0
  );
  const temps = m.changementsTemps.reduce((s, i) => s + (i.deltaEtp ?? 0), 0);
  const sousContrat = somme(m.nouveaux) - sortiesSousContrat + temps;
  const net = sousContrat + sortiesDejaSuspendues + somme(m.retours) - somme(m.sortiesTemporaires);
  return { sousContrat: arrondi(sousContrat), net: arrondi(net) };
}
