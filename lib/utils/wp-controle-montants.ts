/**
 * Fichiers « sans salaire » : contrôle des montants à l'import.
 *
 * POURQUOI. Le SIRH exporte les mêmes fichiers avec ou sans les colonnes de
 * paie renseignées (« StatRapides … sans salaire.xlsx », rosters « without
 * sal »). Les en-têtes sont là, les cellules sont vides, et `parseNumeric`
 * fait d'une cellule vide un 0 : le mois s'importait avec 1 382 lignes à 0 €
 * sans que rien ne le signale. La page Coûts sait déjà traiter ces mois comme
 * « sans montants » ; il faut que l'importateur le sache AU MOMENT de l'import.
 *
 * Un fichier dont les colonnes sont ABSENTES n'est pas un fichier sans
 * salaire : c'est un autre format, déjà traité ailleurs. Aucun message.
 *
 * Consultatif : l'import reste possible.
 */

/** En deçà de cette part de lignes renseignées, le fichier est signalé comme partiel. */
export const SEUIL_MONTANTS_PARTIELS = 0.5;

export interface LigneMontantsSalariaux {
  total_brut?: unknown;
  brut_base?: unknown;
  cout_total_secu?: unknown;
  supplements?: unknown;
}

export interface LigneBrutIndice {
  brut_indice?: unknown;
}

export interface ControleMontantsSalariaux {
  /** Colonnes € présentes mais aucune ligne avec un montant > 0. */
  sansMontants: boolean;
  n: number;
  avecMontants: number;
}

export interface ControleBrutIndice {
  /** Colonne Brut indice présente mais vide partout. */
  sansSalaire: boolean;
  n: number;
  avecBrut: number;
}

const positif = (v: unknown): boolean => {
  const x = Number(v);
  return Number.isFinite(x) && x > 0;
};

/** Statistiques rapides : colonnes € présentes mais aucune ligne avec un montant > 0. */
export function controlerMontantsSalariaux(
  rows: LigneMontantsSalariaux[],
  colonnesPresentes: boolean
): ControleMontantsSalariaux {
  const n = rows.length;
  const avecMontants = colonnesPresentes
    ? rows.filter((r) => positif(r.total_brut) || positif(r.brut_base) || positif(r.cout_total_secu) || positif(r.supplements)).length
    : 0;
  return { sansMontants: colonnesPresentes && n > 0 && avecMontants === 0, n, avecMontants };
}

/** Roster : colonne Brut indice présente mais vide partout. */
export function controlerBrutIndice(rows: LigneBrutIndice[], colonnePresente: boolean): ControleBrutIndice {
  const n = rows.length;
  const avecBrut = colonnePresente ? rows.filter((r) => positif(r.brut_indice)).length : 0;
  return { sansSalaire: colonnePresente && n > 0 && avecBrut === 0, n, avecBrut };
}

const nf0 = (x: number) => x.toLocaleString("fr-FR", { maximumFractionDigits: 0 });

/** Quelques lignes renseignées seulement : à signaler, sans bloquer. */
const partiel = (renseignees: number, n: number): boolean =>
  renseignees > 0 && renseignees < n * SEUIL_MONTANTS_PARTIELS;

/** Avertissements pour l'écran d'import. Tableau vide quand il n'y a rien à dire. */
export function messagesControleMontantsSalariaux(r: ControleMontantsSalariaux): string[] {
  if (r.sansMontants) {
    return [
      `Fichier « sans salaire » : les colonnes de montants (Total brut, Brut base, Suppléments, Total SECU) ` +
        `sont présentes mais vides sur les ${nf0(r.n)} lignes. ` +
        `Le mois sera importé, mais ne servira ni au coût réalisé ni au coefficient de charges de la page Coûts.`,
    ];
  }
  if (partiel(r.avecMontants, r.n)) {
    const sans = r.n - r.avecMontants;
    return [
      `${nf0(sans)} ligne${sans > 1 ? "s" : ""} sur ${nf0(r.n)} sans montant (Total brut, Brut base, Suppléments, Total SECU vides). ` +
        `Le mois sera importé tel quel ; le coût réalisé et le coefficient de charges de la page Coûts ne porteront que sur les ${nf0(r.avecMontants)} lignes renseignées.`,
    ];
  }
  return [];
}

export function messagesControleBrutIndice(r: ControleBrutIndice): string[] {
  if (r.sansSalaire) {
    return [
      `Roster sans salaire : la colonne Brut indice est vide sur les ${nf0(r.n)} lignes. ` +
        `Les coûts contractuels de ce mois seront lus dans la dernière photo qui en porte (page Coûts, tracé en pointillé).`,
    ];
  }
  if (partiel(r.avecBrut, r.n)) {
    const sans = r.n - r.avecBrut;
    return [
      `${nf0(sans)} ligne${sans > 1 ? "s" : ""} sur ${nf0(r.n)} sans Brut indice. ` +
        `Le roster sera importé tel quel ; les coûts contractuels de ce mois ne porteront que sur les ${nf0(r.avecBrut)} salariés renseignés.`,
    ];
  }
  return [];
}
