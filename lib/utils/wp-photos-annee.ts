/**
 * Photos de roster d'une année, prêtes pour la courbe d'effectifs : chaque
 * mois se lit dans SA photo (reconduite de la plus récente antérieure à
 * défaut), filtrée sur le périmètre et reclassifiée (sorties temporaires
 * maladie). Partagé par le tableau de bord, la page Coûts et l'analyste IA,
 * pour que tous trois comptent les mêmes effectifs.
 *
 * Attention : la reclassification MODIFIE les lignes des photos indexées,
 * comme elle l'a toujours fait dans les pages. Un appelant qui réutilise ses
 * lignes ailleurs (l'analyste IA) doit lui confier des copies.
 */

import { rangPeriode } from "./roster-period";
import { photoPourLeMois, type PhotosParRang } from "./roster-photos";
import type { MoisAnnee } from "./wp-courbe-effectifs";
import type { SortiHorsPhoto } from "./wp-effectif-moyen";
import { computeRosterMovements, reclassifierSortiesTemporaires, type MovementEmployee, type SortieConstatee } from "./wp-movements";

/** Codes des salariés avec des heures maladie CNS, sur une ou plusieurs listes d'absences. */
export function codesAvecMaladieCns(...listes: { code_salarie: unknown; hrs_maladie?: unknown }[][]): Set<string> {
  return new Set(listes.flatMap((l) => l.filter((a) => Number(a.hrs_maladie || 0) > 0).map((a) => String(a.code_salarie))));
}

export interface EntreesPhotosAnnee<T extends MovementEmployee> {
  annee: number;
  photosParRang: PhotosParRang<T>;
  /** Repli quand aucune photo n'existe : la photo affichée, déjà filtrée et reclassifiée. */
  photoAffichee: T[];
  passe: (e: T) => boolean;
  /** Codes maladie CNS de toute l'année (un salarié absent de la photo affichée peut l'être d'une autre). */
  codesMaladie: Set<string>;
  /** Sorties constatées (IN/OUT, puis statistiques salariales) sur un mois et le précédent. */
  sortiesConstateesSur: (mois: number, annee: number, prec: MoisAnnee) => Map<string, SortieConstatee>;
}

export function preparerPhotosAnnee<T extends MovementEmployee>(e: EntreesPhotosAnnee<T>) {
  const { annee, photosParRang, photoAffichee, passe, codesMaladie, sortiesConstateesSur } = e;
  const photosPreparees = new Map<number, T[]>();
  const photoDuMoisDe = (m: number, a: number): T[] => {
    const { lignes, periode } = photoPourLeMois(photosParRang, m, a);
    if (!periode) return photoAffichee;
    const r = rangPeriode(periode);
    let prete = photosPreparees.get(r);
    if (!prete) {
      prete = reclassifierSortiesTemporaires(lignes.filter(passe), codesMaladie);
      photosPreparees.set(r, prete);
    }
    return prete;
  };
  const photoDuMois = (m: number) => photoDuMoisDe(m, annee);
  const photoExacte = (m: number, a: number) => photoPourLeMois(photosParRang, m, a).exacte;

  // Sortis du mois absents de la photo : repris seulement si le mois ET le
  // précédent ont chacun LEUR photo — comparer une photo reconduite à
  // elle-même n'apprend rien.
  const sortisHorsPhotoPour = (m: number): SortiHorsPhoto[] => {
    const precM: MoisAnnee = m === 1 ? { mois: 12, annee: annee - 1 } : { mois: m - 1, annee };
    if (!photoExacte(m, annee) || !photoExacte(precM.mois, precM.annee)) return [];
    const codesPhotoM = new Set(photoDuMois(m).map((x) => x.code_salarie));
    return computeRosterMovements(
      photoDuMoisDe(precM.mois, precM.annee), photoDuMois(m), m, annee,
      sortiesConstateesSur(m, annee, precM)
    ).sortiesDefinitives
      .filter((i) => i.date && !codesPhotoM.has(i.code_salarie))
      .map((i) => ({ date_sortie: i.date!, taux_occupation: i.etp * 100 }));
  };

  return { photoDuMoisDe, photoDuMois, photoExacte, sortisHorsPhotoPour };
}
