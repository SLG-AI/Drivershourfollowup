/**
 * Photographies de roster indexées par période, et lecture « un mois = sa
 * photo ».
 *
 * Un export SIRH ne contient que les présents à sa date. Reconstruire une
 * série mensuelle depuis une seule photo par les dates d'entrée/sortie
 * ignore les embauches postérieures et les départs antérieurs à l'export :
 * la courbe culmine toujours sur le mois de la photo. Toute lecture
 * multi-mois de wp_employees doit donc passer par ici.
 */

import { choisirPeriodeRoster, rangPeriode, type RosterPeriod } from "./roster-period";

export interface LignePhoto {
  mois: number | string;
  annee: number | string;
}

export type PhotosParRang<T> = Map<number, T[]>;

/** Regroupe des lignes de wp_employees (plusieurs périodes) par rang de période. */
export function indexerPhotos<T extends LignePhoto>(lignes: T[]): PhotosParRang<T> {
  const photos: PhotosParRang<T> = new Map();
  for (const ligne of lignes) {
    const r = rangPeriode({ mois: Number(ligne.mois), annee: Number(ligne.annee) });
    const liste = photos.get(r);
    if (liste) liste.push(ligne);
    else photos.set(r, [ligne]);
  }
  return photos;
}

/** Ajoute une photo déjà chargée si sa période manque (repli d'une autre année). */
export function ajouterPhotoSiAbsente<T>(photos: PhotosParRang<T>, periode: RosterPeriod | null, lignes: T[]): void {
  if (!periode) return;
  const r = rangPeriode(periode);
  if (!photos.has(r)) photos.set(r, lignes);
}

export function periodesDesPhotos<T>(photos: PhotosParRang<T>): RosterPeriod[] {
  return [...photos.keys()].map((r) => ({
    annee: Math.floor((r - 1) / 12),
    mois: ((r - 1) % 12) + 1,
  }));
}

/**
 * Photo à lire pour un mois : la sienne, sinon la plus récente antérieure
 * (un effectif se reconduit, y compris vers les mois à venir), sinon la plus
 * ancienne. Rend `[]` sans aucune photo.
 */
export function photoPourLeMois<T>(
  photos: PhotosParRang<T>,
  mois: number,
  annee: number
): { lignes: T[]; periode: RosterPeriod | null; exacte: boolean } {
  const { periode, exacte } = choisirPeriodeRoster(periodesDesPhotos(photos), mois, annee);
  if (!periode) return { lignes: [], periode: null, exacte: false };
  return { lignes: photos.get(rangPeriode(periode)) ?? [], periode, exacte };
}
