/**
 * Préparation des lignes de statistiques salariales avant insertion.
 *
 * Le fichier StatRapides porte un mois de référence par ligne ; le mois et
 * l'année choisis à l'écran servent de REPLI pour les lignes qui n'en ont pas
 * de valide (cellule vide, valeur hors 1..12). Les lignes toujours sans
 * période après ce repli sont écartées : la table impose mois BETWEEN 1 AND 12
 * et l'insertion entière échouerait sinon.
 */
export interface LignesSalarialesPreparees {
  lignes: Record<string, unknown>[];
  ecartees: number;
  /** Période effective (celle de la première ligne retenue), utilisée pour purger le mois avant réinsertion. */
  periode: { mois: number; annee: number } | null;
}

export function preparerStatsSalariales(
  data: Record<string, unknown>[],
  importId: string,
  moisChoisi?: number,
  anneeChoisie?: number,
): LignesSalarialesPreparees {
  const lignes: Record<string, unknown>[] = [];
  let ecartees = 0;

  for (const row of data) {
    const moisLu = Number(row.mois);
    const anneeLue = Number(row.annee);
    const mois = moisLu >= 1 && moisLu <= 12 ? moisLu : moisChoisi ?? 0;
    const annee = anneeLue > 2000 ? anneeLue : anneeChoisie ?? 0;

    if (!(mois >= 1 && mois <= 12) || !(annee > 2000)) {
      ecartees++;
      continue;
    }

    lignes.push({ ...row, mois, annee, import_id: importId });
  }

  const premiere = lignes[0];
  const periode = premiere ? { mois: premiere.mois as number, annee: premiere.annee as number } : null;

  return { lignes, ecartees, periode };
}
