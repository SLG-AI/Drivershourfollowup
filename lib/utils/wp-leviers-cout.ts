/**
 * Leviers de coût d'un scénario (table wp_scenario_cost_params) : hausses de
 * salaire (indexation, augmentation), plancher SSM, coefficient de charges
 * forcé et primes ponctuelles, chacun daté d'un mois d'effet et global
 * (centre_cout null) ou propre à un cost center.
 *
 * Un levier ne compte qu'à partir du PREMIER MOIS PROJETÉ : les tranches
 * antérieures sont déjà portées par le brut de la photo de roster, les
 * réappliquer les compterait deux fois. Module pur, sans accès aux données.
 */

export type TypeLevier = "indexation" | "augmentation" | "ssm" | "coefficient" | "prime";
export type ModeLevier = "pct" | "seuil_etp" | "coef" | "montant_global" | "montant_etp";

export interface LevierCout {
  id?: string;
  scenario_id?: string;
  type: TypeLevier;
  /** null = levier global */
  centre_cout: string | null;
  annee_effet: number;
  mois_effet: number;
  valeur: number;
  mode: ModeLevier;
  libelle?: string | null;
}

export interface MoisAnnee {
  mois: number;
  annee: number;
}

export const LIBELLES_LEVIER: Record<TypeLevier, string> = {
  indexation: "Indexation",
  augmentation: "Augmentation",
  ssm: "Salaire social minimum",
  coefficient: "Coefficient de charges",
  prime: "Prime",
};

export const AIDE_LEVIER: Record<TypeLevier, string> = {
  indexation: "Hausse en % du brut plein temps à partir du mois d'effet, cumulée avec les autres tranches (2,5 % puis 2,5 % = ×1,050625).",
  augmentation: "Hausse en % du brut plein temps à partir du mois d'effet, cumulée comme une indexation.",
  ssm: "Plancher de brut plein temps mensuel à partir du mois d'effet : tout brut indexé inférieur est relevé à ce seuil, lui-même relevé par les hausses postérieures.",
  coefficient: "Remplace le coefficient de charges calculé à partir du mois d'effet (le plus récent l'emporte, un cost center prime sur le global).",
  prime: "Montant versé le mois d'effet uniquement, en € pour le périmètre ou en € par ETP payé.",
};

export const MODE_PAR_TYPE: Record<TypeLevier, ModeLevier[]> = {
  indexation: ["pct"],
  augmentation: ["pct"],
  ssm: ["seuil_etp"],
  coefficient: ["coef"],
  prime: ["montant_global", "montant_etp"],
};

export const LIBELLES_MODE: Record<ModeLevier, string> = {
  pct: "Pourcentage",
  seuil_etp: "Seuil plein temps",
  coef: "Coefficient",
  montant_global: "Montant global",
  montant_etp: "Montant par ETP",
};

export function unite(mode: ModeLevier): string {
  switch (mode) {
    case "pct": return "%";
    case "seuil_etp": return "€ brut plein temps / mois";
    case "coef": return "coefficient";
    case "montant_global": return "€";
    case "montant_etp": return "€ par ETP";
  }
}

/** Rang absolu d'un mois pour comparer des (année, mois) */
function rang(m: MoisAnnee): number {
  return m.annee * 12 + m.mois;
}

function rangEffet(l: LevierCout): number {
  return l.annee_effet * 12 + l.mois_effet;
}

/** Leviers applicables à un cost center : les siens + les globaux (centre_cout null). */
export function leviersPour(leviers: LevierCout[], cc: string | null): LevierCout[] {
  return leviers.filter((l) => l.centre_cout === null || l.centre_cout === cc);
}

/** Le levier a pris effet entre le premier mois projeté et m inclus. */
export function estEffectif(l: LevierCout, m: MoisAnnee, premierMoisProjete: MoisAnnee): boolean {
  const r = rangEffet(l);
  return r >= rang(premierMoisProjete) && r <= rang(m);
}

function estHausse(l: LevierCout): boolean {
  return (l.type === "indexation" || l.type === "augmentation") && l.mode === "pct";
}

/**
 * Π (1 + valeur/100) des indexations et augmentations effectives en m (cost
 * center + global). Les tranches antérieures au premier mois projeté sont
 * ignorées : le brut de la photo les porte déjà.
 */
export function facteurHausse(
  leviers: LevierCout[],
  cc: string | null,
  m: MoisAnnee,
  premierMoisProjete: MoisAnnee
): number {
  return leviersPour(leviers, cc)
    .filter((l) => estHausse(l) && estEffectif(l, m, premierMoisProjete))
    .reduce((f, l) => f * (1 + l.valeur / 100), 1);
}

/**
 * Levier le plus récent d'un type parmi les effectifs : ceux du cost center
 * priment sur les globaux, puis le mois d'effet le plus tardif (à date égale,
 * le dernier saisi).
 */
function plusRecent(
  leviers: LevierCout[],
  type: TypeLevier,
  cc: string | null,
  m: MoisAnnee,
  premierMoisProjete: MoisAnnee
): LevierCout | null {
  const candidats = leviersPour(leviers, cc).filter((l) => l.type === type && estEffectif(l, m, premierMoisProjete));
  const propres = cc !== null ? candidats.filter((l) => l.centre_cout === cc) : [];
  const retenus = propres.length > 0 ? propres : candidats;
  let meilleur: LevierCout | null = null;
  for (const l of retenus) {
    if (meilleur === null || rangEffet(l) >= rangEffet(meilleur)) meilleur = l;
  }
  return meilleur;
}

/**
 * Seuil SSM en vigueur en m : dernier levier ssm effectif (cost center
 * prioritaire sur global), relevé des hausses postérieures à son propre mois
 * d'effet (celles de son mois d'effet sont réputées comprises dans le seuil
 * saisi). null sans levier ssm effectif.
 */
export function seuilSsm(
  leviers: LevierCout[],
  cc: string | null,
  m: MoisAnnee,
  premierMoisProjete: MoisAnnee
): number | null {
  const ssm = plusRecent(leviers, "ssm", cc, m, premierMoisProjete);
  if (!ssm) return null;
  const rangSsm = rangEffet(ssm);
  const releve = leviersPour(leviers, cc)
    .filter((l) => estHausse(l) && estEffectif(l, m, premierMoisProjete) && rangEffet(l) > rangSsm)
    .reduce((f, l) => f * (1 + l.valeur / 100), 1);
  return ssm.valeur * releve;
}

/**
 * Brut plein temps du mois m : brut de la photo indexé par les hausses
 * effectives, puis relevé au seuil SSM s'il lui est inférieur. `releve` dit
 * si le plancher a joué.
 */
export function brutPleinTempsAvecLeviers(
  brut: number,
  leviers: LevierCout[],
  cc: string | null,
  m: MoisAnnee,
  premierMoisProjete: MoisAnnee
): { brut: number; releve: boolean } {
  const indexe = brut * facteurHausse(leviers, cc, m, premierMoisProjete);
  const seuil = seuilSsm(leviers, cc, m, premierMoisProjete);
  if (seuil !== null && indexe < seuil) return { brut: seuil, releve: true };
  return { brut: indexe, releve: false };
}

/** Coefficient de charges forcé le plus récent effectif (cost center puis global), sinon coefBase. */
export function coefficientPour(
  leviers: LevierCout[],
  cc: string | null,
  m: MoisAnnee,
  premierMoisProjete: MoisAnnee,
  coefBase: number
): number {
  const force = plusRecent(leviers, "coefficient", cc, m, premierMoisProjete);
  return force ? force.valeur : coefBase;
}

/**
 * Primes du mois m EXACT (mois d'effet == m), cost center + global :
 * Σ montant_global + Σ montant_etp × etpPaye.
 */
export function primesDuMois(leviers: LevierCout[], cc: string | null, m: MoisAnnee, etpPaye: number): number {
  const r = rang(m);
  return leviersPour(leviers, cc)
    .filter((l) => l.type === "prime" && rangEffet(l) === r)
    .reduce((total, l) => total + (l.mode === "montant_etp" ? l.valeur * etpPaye : l.valeur), 0);
}
