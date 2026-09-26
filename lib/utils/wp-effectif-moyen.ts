/**
 * Effectif MOYEN du mois en ETP, pondéré par les jours.
 *
 * Les KPI du tableau de bord donnent l'effectif au dernier jour du mois. Un
 * salarié entré le 20 ou sorti le 10 y compte pour 1 ou pour 0, alors qu'il a
 * pesé une fraction du mois. La moyenne journalière rend cette réalité :
 * chaque jour du mois, on somme les ETP sous contrat et les ETP en suspension
 * de contrat, puis on divise par le nombre de jours.
 *
 * Les règles d'activité et de suspension sont CELLES du tableau de bord
 * (`getActiveEmployeesAt`, `isTempExitAt`) évaluées jour par jour :
 *  - actif si entré au plus tard ce jour et pas sorti avant ce jour ;
 *  - un sorti en suspension de contrat reste dans le système ;
 *  - suspendu si le drapeau est posé, la sortie est antérieure au jour
 *    et la fin de suspension n'est pas dépassée ; la suspension ne retire
 *    que la FRACTION suspendue (`fractionSuspendueEmploye` : 0.5 pour un
 *    congé parental à temps partiel par motif, 0 quand le taux réduit porte
 *    déjà la réduction).
 *
 * Les sortis du mois ABSENTS de la photographie (l'export SIRH ne les
 * reconduit pas) sont fournis à part, avec leur date de sortie, et comptent
 * jusqu'à ce jour inclus.
 */

import { isTempExitAt } from "./wp-calculations";
import { fractionSuspendueEmploye } from "./wp-suspension";

export interface EffectifMoyenEmployee {
  date_entree?: string | null;
  date_sortie?: string | null;
  est_sortie_temporaire: boolean;
  date_fin_sortie_temporaire?: string | null;
  taux_occupation?: number | null;
  /** Servent à la fraction suspendue (congé parental à temps partiel : 0.5 par motif, 0 quand le taux porte déjà la réduction). */
  description_motif_sortie?: string | null;
  date_debut_sortie_temporaire?: string | null;
}

export interface SortiHorsPhoto {
  /** Date de sortie (constatée ou prévue). Aucun jour compté si elle est antérieure au mois. */
  date_sortie: string;
  taux_occupation?: number | null;
}

export interface EffectifMoyen {
  /** ETP sous contrat, moyenne journalière du mois. */
  brut: number;
  /** ETP en suspension de contrat, moyenne journalière du mois. */
  suspendus: number;
  /** brut − suspendus */
  net: number;
  jours: number;
}

function etpOf(e: { taux_occupation?: number | null }): number {
  const t = Number(e.taux_occupation);
  return e.taux_occupation !== null && e.taux_occupation !== undefined && Number.isFinite(t) ? t / 100 : 1;
}

function isoDay(annee: number, mois: number, jour: number): string {
  return `${annee}-${String(mois).padStart(2, "0")}-${String(jour).padStart(2, "0")}`;
}

/** Nombre de jours du mois (1-indexé). */
export function joursDuMois(annee: number, mois: number): number {
  return new Date(annee, mois, 0).getDate();
}

/** Même règle que `getActiveEmployeesAt` du tableau de bord. */
export function estActifLe(e: EffectifMoyenEmployee, date: string): boolean {
  if (e.date_entree && e.date_entree > date) return false;
  if (e.date_sortie && e.date_sortie < date) return e.est_sortie_temporaire;
  return true;
}

export function computeEffectifMoyen(
  employees: EffectifMoyenEmployee[],
  sortisHorsPhoto: SortiHorsPhoto[],
  mois: number,
  annee: number
): EffectifMoyen {
  const jours = joursDuMois(annee, mois);
  let sommeBrut = 0;
  let sommeSuspendus = 0;

  for (let j = 1; j <= jours; j++) {
    const date = isoDay(annee, mois, j);
    for (const e of employees) {
      if (!estActifLe(e, date)) continue;
      const etp = etpOf(e);
      sommeBrut += etp;
      if (isTempExitAt(e, date)) sommeSuspendus += etp * fractionSuspendueEmploye(e);
    }
    for (const s of sortisHorsPhoto) {
      if (s.date_sortie >= date) sommeBrut += etpOf(s);
    }
  }

  const brut = sommeBrut / jours;
  const suspendus = sommeSuspendus / jours;
  return { brut, suspendus, net: brut - suspendus, jours };
}

// ============================================================
// Courbe d'évolution : un point de fin de mois exprimé en moyenne du mois
// ============================================================

/** Paliers d'un mois, en ETP. Les champs absents le restent. */
export interface PaliersDuPoint {
  effectif_brut: number;
  effectif_net: number;
  effectif_reel?: number;
  effectif_apres_injustifiees?: number;
  projected_apres_injustifiees?: number;
  effectif_apres_mct?: number;
  projected_apres_mct?: number;
}

const arrondi1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Convertit les paliers de FIN de mois en MOYENNE du mois.
 *
 * Sous contrat et net viennent de la moyenne journalière (`computeEffectifMoyen`).
 * Les paliers suivants retirent des absences dont les TAUX sont déjà des
 * moyennes du mois, rapportés à l'effectif net : on les applique donc à
 * l'effectif net moyen. Comme chaque palier vaut « net × (1 − taux cumulés) »,
 * cela revient à le multiplier par net moyen / net de fin de mois — exactement
 * ce que font les cartes KPI (« Effectif moyen payé », « disponible »…), de
 * sorte que le point du mois affiché et ses cartes donnent le même chiffre.
 */
export function paliersEnMoyenne(fin: PaliersDuPoint, moyenne: Pick<EffectifMoyen, "brut" | "net">): PaliersDuPoint {
  const k = fin.effectif_net > 0 ? moyenne.net / fin.effectif_net : 1;
  const echelle = (v: number | undefined) => (v == null ? undefined : Math.max(0, arrondi1(v * k)));
  return {
    effectif_brut: arrondi1(moyenne.brut),
    effectif_net: Math.max(0, arrondi1(moyenne.net)),
    effectif_reel: echelle(fin.effectif_reel),
    effectif_apres_injustifiees: echelle(fin.effectif_apres_injustifiees),
    projected_apres_injustifiees: echelle(fin.projected_apres_injustifiees),
    effectif_apres_mct: echelle(fin.effectif_apres_mct),
    projected_apres_mct: echelle(fin.projected_apres_mct),
  };
}

