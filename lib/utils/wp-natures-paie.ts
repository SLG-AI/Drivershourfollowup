/**
 * Natures de paie de la « Liste des salaires » et leur classement en familles.
 *
 * POURQUOI. Les Statistiques rapides ne donnent qu'un bloc « Suppléments » ;
 * la Liste des salaires décompose le brut en une vingtaine de natures (nuit,
 * dimanche, amplitudes, heures supplémentaires, primes, régularisations…).
 * Ce que la direction veut lire n'est pas la nature elle-même mais ce qu'elle
 * traduit : une part STRUCTURELLE (le contrat), une part PILOTÉE PAR LE
 * PLANNING (ce que l'organisation des tournées coûte en plus), des primes,
 * des régularisations, des soldes de sortie et des avantages. Le classement
 * est un arbitrage utilisateur (24/09/2026) ; il vit ici, à un seul endroit,
 * pour être réarbitré sans toucher ni au parseur ni aux pages.
 *
 * Le parseur reconnaît une nature par son CODE (« SHN - Supplément heures de
 * nuit » ⇒ SHN) : le libellé peut changer d'un export à l'autre, le code non.
 * « Autres CS » n'a pas de code, c'est le fourre-tout des compléments de
 * salaire ; il est reconnu par son libellé exact.
 */

export type FamilleNature = "structurel" | "planning" | "primes" | "regularisations" | "soldes" | "avantages";

export interface NaturePaie {
  /**
   * Codes SIRH tels qu'ils précèdent le tiret dans l'en-tête (vide pour
   * « Autres CS »). Plusieurs codes = une même nature sous deux libellés
   * (CCT et P001 sont tous deux le complément de salaire).
   */
  codes: string[];
  /** Colonne de wp_salary_lines. */
  cle: `nat_${string}`;
  libelle: string;
  famille: FamilleNature;
}

export const FAMILLES: { id: FamilleNature; libelle: string; description: string }[] = [
  { id: "structurel", libelle: "Structurel", description: "Brut de base et compléments contractuels : ce que coûte l'effectif indépendamment du planning." },
  { id: "planning", libelle: "Piloté par le planning", description: "Nuit, dimanche, amplitudes, heures supplémentaires, fériés, dépannages : ce que l'organisation des tournées ajoute au contrat." },
  { id: "primes", libelle: "Primes", description: "Primes ponctuelles et ajouts au brut." },
  { id: "regularisations", libelle: "Régularisations", description: "Retenues pour absences injustifiées et congés trop pris (montants négatifs)." },
  { id: "soldes", libelle: "Soldes de sortie", description: "Décomptes de congés versés à la sortie : hors masse salariale courante, mais bien décaissés." },
  { id: "avantages", libelle: "Avantages", description: "Avantages en nature et allocations (voiture, compléments divers)." },
];

/** Les natures connues, dans l'ordre du fichier. Une nature absente du fichier vaut 0. */
export const NATURES: NaturePaie[] = [
  { codes: ["ABIN"], cle: "nat_abin", libelle: "Absence injustifiée", famille: "regularisations" },
  { codes: ["AJ"], cle: "nat_aj", libelle: "Ajout brut", famille: "primes" },
  { codes: ["ALL"], cle: "nat_all", libelle: "Car allowance", famille: "avantages" },
  { codes: ["AM1"], cle: "nat_am1", libelle: "Amplitude > 11 h", famille: "planning" },
  { codes: ["AM2"], cle: "nat_am2", libelle: "Amplitude > 12 h", famille: "planning" },
  // Prorata du 13e mois versé chaque mois aux chauffeurs de plus d'un an
  // d'ancienneté ; le SIRH le porte sous deux codes (CCT et P001).
  { codes: ["CCT", "P001"], cle: "nat_cct", libelle: "Complément salaire (13e mois proratisé)", famille: "structurel" },
  { codes: ["CGTP"], cle: "nat_cgtp", libelle: "Congés trop pris", famille: "regularisations" },
  { codes: ["DC"], cle: "nat_dc", libelle: "Décompte congé", famille: "soldes" },
  { codes: ["E002"], cle: "nat_e002", libelle: "Subvention d'intérêts", famille: "avantages" },
  { codes: ["HFM"], cle: "nat_hfm", libelle: "Heures fériées majorées", famille: "planning" },
  { codes: ["HSM"], cle: "nat_hsm", libelle: "Heures sup. majorées", famille: "planning" },
  { codes: ["PERM"], cle: "nat_perm", libelle: "Permanence", famille: "planning" },
  { codes: ["PR D"], cle: "nat_pr_d", libelle: "Prime dépannage", famille: "planning" },
  // Formateurs, team leaders, délégués du personnel (dès octobre 2026) : récurrente chaque mois.
  { codes: ["PR F"], cle: "nat_pr_f", libelle: "Prime de fonction", famille: "structurel" },
  { codes: ["PRIM"], cle: "nat_prim", libelle: "Prime", famille: "primes" },
  { codes: ["PRR"], cle: "nat_prr", libelle: "Prime repos", famille: "primes" },
  { codes: ["SHD"], cle: "nat_shd", libelle: "Supplément dimanche", famille: "planning" },
  { codes: ["SHN"], cle: "nat_shn", libelle: "Supplément nuit", famille: "planning" },
  { codes: ["SMG"], cle: "nat_smg", libelle: "Supplément moyenne congé", famille: "structurel" },
  { codes: [], cle: "nat_autres_cs", libelle: "Autres compléments", famille: "avantages" },
];

/**
 * Nature reconnue par un en-tête de colonne normalisé (minuscules, sans
 * accents, espaces réduits) : « shn - supplement heures de nuit » ⇒ SHN.
 * Le code est comparé AVANT le tiret, jamais par inclusion : « PR D » ne doit
 * pas accrocher « PR F », ni « AM1 » « AM2 ».
 */
export function natureDepuisEntete(enteteNormalise: string): NaturePaie | null {
  const h = enteteNormalise.replace(/\s+/g, " ").trim();
  if (h === "autres cs") return NATURES.find((n) => n.codes.length === 0) ?? null;
  const avantTiret = h.split(" - ")[0]?.trim();
  if (!avantTiret) return null;
  return NATURES.find((n) => n.codes.some((c) => c.toLowerCase() === avantTiret)) ?? null;
}

/** Une ligne de paie : le brut de base et ses natures (clés `nat_*`), telle que wp_salary_lines la porte. */
export interface LigneNatures {
  brut_base?: unknown;
  [nature: `nat_${string}`]: unknown;
}

export type MontantsParFamille = Record<FamilleNature, number>;

const nombre = (v: unknown): number => {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
};

export function famillesVides(): MontantsParFamille {
  return { structurel: 0, planning: 0, primes: 0, regularisations: 0, soldes: 0, avantages: 0 };
}

/** Somme par famille d'un ensemble de lignes ; le brut de base compte en « structurel ». */
export function decomposerParFamille(lignes: LigneNatures[]): MontantsParFamille {
  const total = famillesVides();
  for (const l of lignes) {
    total.structurel += nombre(l.brut_base);
    for (const n of NATURES) total[n.famille] += nombre(l[n.cle]);
  }
  return total;
}

/** Somme par nature (clé `nat_*`) d'un ensemble de lignes, natures nulles comprises. */
export function decomposerParNature(lignes: LigneNatures[]): Map<`nat_${string}`, number> {
  const total = new Map<`nat_${string}`, number>(NATURES.map((n) => [n.cle, 0]));
  for (const l of lignes) for (const n of NATURES) total.set(n.cle, (total.get(n.cle) ?? 0) + nombre(l[n.cle]));
  return total;
}

/** Σ des natures d'une ligne (sans le brut de base) : total brut = brut base + cette somme. */
export function sommeNatures(l: LigneNatures): number {
  return NATURES.reduce((s, n) => s + nombre(l[n.cle]), 0);
}

// ============================================================
// Décomposition d'un ensemble de lignes (page Coûts)
// ============================================================

/** Ligne de paie datée et rattachée, telle que wp_salary_lines la porte. */
export interface LignePaieDecomposable extends LigneNatures {
  code_salarie: string;
  mois: number | string;
  annee: number | string;
  type_remuneration?: string | null;
  fonction?: string | null;
  total_brut?: unknown;
}

export interface DecompositionMois {
  mois: number;
  familles: MontantsParFamille;
  /** Σ total brut des lignes du mois (salaire et non périodique). */
  brut: number;
  n: number;
}

/**
 * Familles par mois d'une année, lignes de salaire ET non périodiques : les
 * soldes de sortie (nat_dc) tombent d'eux-mêmes dans « soldes ». Le périmètre
 * (`codes`) est celui de la page : les salariés de la photo roster filtrée.
 */
export function decomposerParMois(lignes: LignePaieDecomposable[], annee: number, codes?: Set<string>): DecompositionMois[] {
  const parMois = new Map<number, LignePaieDecomposable[]>();
  for (const l of lignes) {
    if (Number(l.annee) !== annee) continue;
    if (codes && !codes.has(l.code_salarie)) continue;
    const m = Number(l.mois);
    parMois.set(m, [...(parMois.get(m) ?? []), l]);
  }
  return [...parMois.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([mois, ls]) => ({
      mois,
      familles: decomposerParFamille(ls),
      brut: ls.reduce((s, l) => s + nombre(l.total_brut), 0),
      n: ls.length,
    }));
}

export interface VentilationLigne {
  cle: string;
  familles: MontantsParFamille;
  brut: number;
  n: number;
  /** Part du brut pilotée par le planning, en % (null sans brut). */
  partPlanning: number | null;
}

/**
 * Ventilation d'un ensemble de lignes selon une clé (dépôt du roster, fonction
 * de la paie…), triée par brut décroissant. Les lignes dont la clé est vide
 * sont regroupées sous `sansCle`.
 */
export function ventilerPar(
  lignes: LignePaieDecomposable[],
  cleDe: (l: LignePaieDecomposable) => string | null | undefined,
  sansCle = "(non rattaché)"
): VentilationLigne[] {
  const groupes = new Map<string, LignePaieDecomposable[]>();
  for (const l of lignes) {
    const k = cleDe(l) || sansCle;
    groupes.set(k, [...(groupes.get(k) ?? []), l]);
  }
  return [...groupes.entries()]
    .map(([cle, ls]) => {
      const familles = decomposerParFamille(ls);
      const brut = ls.reduce((s, l) => s + nombre(l.total_brut), 0);
      return { cle, familles, brut, n: ls.length, partPlanning: brut > 0 ? (familles.planning / brut) * 100 : null };
    })
    .sort((a, b) => b.brut - a.brut);
}
