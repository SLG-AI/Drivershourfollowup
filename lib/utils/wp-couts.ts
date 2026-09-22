/**
 * Chaîne des paliers d'effectif d'un mois, EN EUROS : le jumeau de
 * wp-paliers.ts.
 *
 * POURQUOI : le tableau de bord montre combien d'ETP chaque étape retire ;
 * la direction veut savoir combien cela COÛTE. Un même palier ETP peut cacher
 * des réalités très différentes selon qu'il retire un haut ou un bas salaire,
 * d'où une chaîne parallèle qui pèse chaque salarié par son coût employeur au
 * lieu de son seul ETP. Les deux chaînes suivent les MÊMES populations, les
 * MÊMES lignes d'absence et le MÊME dénominateur horaire ; si tous les
 * salariés gagnaient la même chose, chaque palier en euros serait exactement
 * le palier ETP multiplié par ce salaire (c'est le test d'homothétie).
 *
 * OÙ : le coût contractuel d'un salarié est `brut_indice × ETP × coef`.
 * `brut_indice` est le brut MENSUEL À PLEIN TEMPS de l'indice (vérifié en
 * base : il n'est PAS proratisé par le taux d'occupation, d'où la
 * multiplication par `etpDe`). `coef` est le coefficient de charges
 * patronales, observé sur les statistiques salariales (Σ coût total sécu /
 * Σ brut) ou pris à la valeur par défaut faute de données.
 *
 * Deux sources d'imprécision sont rendues VISIBLES plutôt que masquées :
 *  - un mois dont la photo ne porte aucun salaire lit les bruts dans la
 *    dernière photo qui en a (`SourceSalaires.reporte`) ;
 *  - un salarié sans brut nulle part est compté au coût de repli fourni par
 *    l'appelant, et dénombré dans `reporte.codesManquants`.
 *
 * Les calculs se font en flottant ; les montants ne sont arrondis à l'euro
 * qu'à la sortie.
 */

import { getWorkableHoursInMonth, isTempExitAt, lastDayOfMonth } from "./wp-calculations";
import { estActifLe } from "./wp-effectif-moyen";
import { etpDe, etpDisponibleDe, type LigneCns, type LigneHeures, type SalariePaliers } from "./wp-paliers";
import { fractionSuspendueEmploye } from "./wp-suspension";

/** Coefficient de charges patronales luxembourgeois retenu faute de statistiques salariales. */
export const COEF_CHARGES_DEFAUT = 1.15;

/** Salarié d'une photographie de roster, colonnes utiles aux coûts (en plus de celles des paliers). */
export interface SalarieCout extends SalariePaliers {
  /** Brut mensuel À PLEIN TEMPS de l'indice, non proratisé par le taux d'occupation. */
  brut_indice?: number | string | null;
  centre_cout?: string | null;
  description_service?: string | null;
  description_fonction?: string | null;
  type_contrat?: string | null;
}

/** Ligne des statistiques salariales : un salarié, un mois, ses montants. */
export interface LigneStatSalariale {
  code_salarie: string;
  mois: number | string;
  annee: number | string;
  total_brut?: unknown;
  brut_base?: unknown;
  supplements?: unknown;
  /** « Total SECU » du fichier : total des cotisations salariales et patronales, PAS un coût employeur. */
  cout_total_secu?: unknown;
  /** Somme des cotisations patronales (import), et leur détail. Coût employeur = total_brut + charges_patronales. */
  charges_patronales?: unknown;
  cm_patronale?: unknown;
  cp_patronale?: unknown;
  assurance_accident?: unknown;
  allocation_familiale?: unknown;
  sante_travail?: unknown;
  mutualite?: unknown;
  cot_pat_autres?: unknown;
  centre_cout?: string | null;
}

/** Une ligne dont les charges patronales sont connues : le coût employeur peut en être lu. */
export function ligneAvecCharges(l: LigneStatSalariale): boolean {
  return nombre(l.charges_patronales) > 0;
}
/** Coût employeur d'une ligne = brut + charges patronales. */
export function coutEmployeurDeLaLigne(l: LigneStatSalariale): number {
  return nombre(l.total_brut) + nombre(l.charges_patronales);
}

function nombre(v: unknown): number {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

/** Brut plein temps lisible d'un salarié (strictement positif), sinon null. Une chaîne numérique est acceptée. */
export function brutPleinTempsDe(e: SalarieCout): number | null {
  const n = nombre(e.brut_indice);
  return n > 0 ? n : null;
}

/**
 * Vrai si la ligne porte au moins un montant strictement positif. Un fichier
 * « sans salaire » a bien des lignes, mais toutes à 0 : elles ne mesurent rien.
 */
export function ligneAvecMontants(l: LigneStatSalariale): boolean {
  return nombre(l.total_brut) > 0 || nombre(l.brut_base) > 0 || nombre(l.supplements) > 0 || nombre(l.cout_total_secu) > 0;
}

/** Vrai si au moins un salarié de la photo a un brut plein temps lisible. */
export function photoAvecMontants(photo: SalarieCout[]): boolean {
  return photo.some((e) => brutPleinTempsDe(e) !== null);
}

function dansPerimetre(l: { code_salarie: string }, codes?: Set<string>): boolean {
  return codes === undefined || codes.has(l.code_salarie);
}

/**
 * Réalisé d'un mois : somme des colonnes en euros des lignes du périmètre
 * (`codes` absent ⇒ toutes les lignes). `mesure` est faux quand aucune ligne
 * ne porte de montant : le mois a un fichier, mais vide de salaires.
 */
export function realiseDuMois(
  stats: LigneStatSalariale[],
  mois: number,
  annee: number,
  codes?: Set<string>
): {
  brut: number; brutBase: number; supplements: number;
  /** Coût employeur = brut + charges patronales ; égal au brut quand aucune ligne ne porte de charges. */
  employeur: number;
  chargesPatronales: number;
  /** Détail des charges patronales par nature. */
  charges: { cm: number; cp: number; accident: number; allocation: number; sante: number; mutualite: number; autres: number };
  cotisationsTotales: number;
  n: number;
  mesure: boolean;
  /** Au moins une ligne porte des charges patronales : le coût employeur est lu, pas estimé. */
  employeurMesure: boolean;
} {
  const lignes = stats.filter(
    (l) => Number(l.mois) === mois && Number(l.annee) === annee && dansPerimetre(l, codes)
  );
  const somme = (cle: keyof LigneStatSalariale) => lignes.reduce((s, l) => s + nombre(l[cle]), 0);
  return {
    brut: somme("total_brut"),
    brutBase: somme("brut_base"),
    supplements: somme("supplements"),
    employeur: lignes.reduce((s, l) => s + coutEmployeurDeLaLigne(l), 0),
    chargesPatronales: somme("charges_patronales"),
    charges: {
      cm: somme("cm_patronale"), cp: somme("cp_patronale"), accident: somme("assurance_accident"),
      allocation: somme("allocation_familiale"), sante: somme("sante_travail"), mutualite: somme("mutualite"), autres: somme("cot_pat_autres"),
    },
    cotisationsTotales: somme("cout_total_secu"),
    n: lignes.length,
    mesure: lignes.some(ligneAvecMontants),
    employeurMesure: lignes.some(ligneAvecCharges),
  };
}

export interface SourceCoefficient {
  mois: number;
  annee: number;
  /** Nombre de lignes avec montants ayant servi au ratio. */
  n: number;
  brut: number;
  employeur: number;
  /** « filtre » quand le ratio a pu être calculé sur le périmètre demandé, « entreprise » sinon. */
  perimetre: "filtre" | "entreprise";
}

/** Dernier (annee, mois) parmi des lignes, et les lignes de ce mois. */
function dernierMois(lignes: LigneStatSalariale[]): { mois: number; annee: number; lignes: LigneStatSalariale[] } | null {
  let meilleur: { mois: number; annee: number } | null = null;
  for (const l of lignes) {
    const annee = Number(l.annee);
    const mois = Number(l.mois);
    if (!meilleur || annee > meilleur.annee || (annee === meilleur.annee && mois > meilleur.mois)) {
      meilleur = { mois, annee };
    }
  }
  if (!meilleur) return null;
  const { mois, annee } = meilleur;
  return { mois, annee, lignes: lignes.filter((l) => Number(l.annee) === annee && Number(l.mois) === mois) };
}

/**
 * Coefficient de charges patronales = Σ coût total sécu / Σ brut du DERNIER
 * mois qui porte des montants.
 *
 * On préfère le périmètre demandé (`codes`) : les charges varient avec la
 * structure des salaires, un centre de coût de chauffeurs ne pèse pas comme
 * l'administration. Faute de ligne avec montants dans le périmètre, on prend
 * toute l'entreprise. Faute de tout, ou si le brut est nul (division
 * impossible), on rend `defaut` avec `source` à null pour que l'appelant
 * puisse le dire.
 */
export function calculerCoefficientCharges(
  stats: LigneStatSalariale[],
  codes?: Set<string>,
  defaut: number = COEF_CHARGES_DEFAUT
): { coef: number; source: SourceCoefficient | null } {
  // Seules les lignes dont les charges patronales sont connues donnent un coût employeur
  const avecMontants = stats.filter((l) => ligneAvecMontants(l) && ligneAvecCharges(l));
  const duPerimetre = codes === undefined ? [] : avecMontants.filter((l) => codes.has(l.code_salarie));

  const candidats: Array<{ lignes: LigneStatSalariale[]; perimetre: "filtre" | "entreprise" }> = [];
  if (duPerimetre.length > 0) candidats.push({ lignes: duPerimetre, perimetre: "filtre" });
  candidats.push({ lignes: avecMontants, perimetre: "entreprise" });

  for (const { lignes, perimetre } of candidats) {
    const dernier = dernierMois(lignes);
    if (!dernier) continue;
    const brut = dernier.lignes.reduce((s, l) => s + nombre(l.total_brut), 0);
    const employeur = dernier.lignes.reduce((s, l) => s + coutEmployeurDeLaLigne(l), 0);
    // Garde : un coût employeur ne peut pas être inférieur au brut
    if (brut <= 0 || employeur < brut) continue;
    return {
      coef: employeur / brut,
      source: { mois: dernier.mois, annee: dernier.annee, n: dernier.lignes.length, brut, employeur, perimetre },
    };
  }
  return { coef: defaut, source: null };
}

/**
 * Coefficient de charges par cost center, sur le dernier mois de statistiques
 * salariales qui porte des charges patronales : les charges varient avec la
 * structure des salaires (plafonds, régimes), un centre de chauffeurs ne pèse
 * pas comme l'administration. Un cost center sans ligne ce mois-là garde le
 * coefficient global.
 */
export function calculerCoefficientsParCostCenter(
  stats: LigneStatSalariale[]
): Map<string, { coef: number; n: number; brut: number; employeur: number }> {
  const resultat = new Map<string, { coef: number; n: number; brut: number; employeur: number }>();
  const dernier = dernierMois(stats.filter((l) => ligneAvecMontants(l) && ligneAvecCharges(l) && !!l.centre_cout));
  if (!dernier) return resultat;
  const parCc = new Map<string, LigneStatSalariale[]>();
  dernier.lignes.forEach((l) => {
    const cc = String(l.centre_cout);
    parCc.set(cc, [...(parCc.get(cc) ?? []), l]);
  });
  parCc.forEach((lignes, cc) => {
    const brut = lignes.reduce((s, l) => s + nombre(l.total_brut), 0);
    const employeur = lignes.reduce((s, l) => s + coutEmployeurDeLaLigne(l), 0);
    if (brut > 0 && employeur >= brut) resultat.set(cc, { coef: employeur / brut, n: lignes.length, brut, employeur });
  });
  return resultat;
}

/** D'où vient le brut de chaque salarié du mois. */
export interface SourceSalaires {
  /** Brut plein temps d'un salarié, null s'il n'en a nulle part ou s'il n'est pas dans la photo du mois. */
  brutDe(code: string): number | null;
  /** Vrai dès qu'un brut a été lu hors de la photo du mois. */
  reporte: boolean;
  /** Codes de la photo du mois sans brut nulle part. */
  manquants: string[];
}

/**
 * Le brut d'un salarié vient de la photo du mois quand ELLE porte des
 * montants ; sinon de la photo de référence (la dernière avec montants), par
 * code. Un salarié de la photo du mois qui y est sans brut (entré après
 * l'export des salaires, par exemple) est lui aussi cherché dans la
 * référence, ce qui compte comme un report. Seuls les codes de la photo du
 * mois sont servis : la référence ne fait pas revenir un salarié parti.
 */
export function construireSourceSalaires(photoDuMois: SalarieCout[], photoReference: SalarieCout[] | null): SourceSalaires {
  const duMois = new Map<string, number | null>();
  photoDuMois.forEach((e) => duMois.set(e.code_salarie, brutPleinTempsDe(e)));

  const reference = new Map<string, number>();
  (photoReference ?? []).forEach((e) => {
    const brut = brutPleinTempsDe(e);
    if (brut !== null) reference.set(e.code_salarie, brut);
  });

  const moisPorteDesMontants = photoAvecMontants(photoDuMois);
  const bruts = new Map<string, number>();
  const manquants: string[] = [];
  let reporte = false;

  duMois.forEach((brutDuMois, code) => {
    const depuisLeMois = moisPorteDesMontants && brutDuMois !== null;
    const brut = depuisLeMois ? brutDuMois : reference.get(code) ?? null;
    if (brut === null) {
      manquants.push(code);
      return;
    }
    if (!depuisLeMois) reporte = true;
    bruts.set(code, brut);
  });

  return {
    brutDe: (code) => bruts.get(code) ?? null,
    reporte,
    manquants,
  };
}

/** Une étape de la chaîne en euros, même clé que son homologue ETP. */
export interface EtapeCout {
  cle: string;
  libelle: string;
  /** Coût au terme de l'étape, en euros arrondis. */
  cout: number;
  /** Coût retiré PAR cette étape (0 pour l'étape de départ). */
  retire: number;
  /** false quand le mois n'a aucune donnée pour cette étape : le palier est alors inchangé. */
  mesure: boolean;
}

export interface CoutsMois {
  annee: number;
  mois: number;
  refDate: string;
  /** Coefficient de charges patronales appliqué, tel que fourni. */
  coef: number;

  sousContrat: number;
  coutSuspendu: number;
  apresSuspension: number;

  coutPerduCns: number;
  apresCns: number;

  coutPerduInjustifiees: number;
  /** Coût PAYÉ : après CNS et absences injustifiées, avant MCT. */
  apresInjustifiees: number;

  coutPerduMct: number;
  /** Coût DISPONIBLE : dernier palier, toutes absences retirées. */
  apresMct: number;

  /** Coût employeur moyen d'un ETP sous contrat ce mois = sousContrat / Σ ETP des actifs (0 si aucun). */
  coutMoyenEtp: number;

  etapes: EtapeCout[];

  reporte: {
    /** Au moins un brut lu hors de la photo du mois. */
    cout: boolean;
    /** Salariés actifs comptés au coût de repli faute de brut. */
    codesManquants: number;
  };
}

/**
 * Déroule la chaîne des paliers en euros pour un mois, ligne à ligne sur
 * `calculerPaliers` : mêmes actifs (`estActifLe` au dernier jour), mêmes
 * lignes du mois, mêmes heures travaillables. Les remarques de wp-paliers.ts
 * sur `absencesMct` (hors week-end) et `absencesInjustifiees` (périmètre
 * appliqué par l'appelant) valent ici à l'identique.
 *
 * `opts.coutEtpRepli` est un coût EMPLOYEUR par ETP (charges comprises) : il
 * sert tel quel, sans repasser par `coef`. Absent, un actif sans brut compte
 * 0 et une absence injustifiée d'un salarié hors photo est valorisée au coût
 * moyen d'un ETP du mois.
 */
export function calculerCoutsPaliers(
  employes: SalarieCout[],
  absencesCns: LigneCns[],
  absencesMct: LigneHeures[],
  absencesInjustifiees: LigneHeures[],
  mois: number,
  annee: number,
  opts: { coef: number; source: SourceSalaires; coutEtpRepli?: number; coefParCc?: Map<string, { coef: number }> }
): CoutsMois {
  const { coef, source, coutEtpRepli, coefParCc } = opts;
  // Coefficient du cost center du salarié quand la paie le donne, sinon le global
  const coefDe = (e: SalarieCout) => (e.centre_cout && coefParCc?.get(e.centre_cout)?.coef) || coef;
  const refDate = lastDayOfMonth(annee, mois);
  const heuresTravaillables = getWorkableHoursInMonth(annee, mois);

  const actifs = employes.filter((e) => estActifLe(e, refDate));

  // Coût contractuel d'un salarié : brut plein temps × ETP × charges. Sans
  // brut, le coût de repli (déjà chargé) × ETP, et on le dénombre.
  let codesManquants = 0;
  const cout = new Map<string, number>();
  actifs.forEach((e) => {
    const brut = source.brutDe(e.code_salarie);
    if (brut === null) {
      codesManquants += 1;
      cout.set(e.code_salarie, (coutEtpRepli ?? 0) * etpDe(e));
    } else {
      cout.set(e.code_salarie, brut * etpDe(e) * coefDe(e));
    }
  });
  const coutDe = (e: SalarieCout) => cout.get(e.code_salarie) ?? 0;

  const sousContrat = actifs.reduce((s, e) => s + coutDe(e), 0);
  const etpSousContrat = actifs.reduce((s, e) => s + etpDe(e), 0);
  const coutMoyenEtp = etpSousContrat > 0 ? sousContrat / etpSousContrat : 0;

  const suspendus = actifs.filter((e) => isTempExitAt(e, refDate));
  const coutSuspendu = suspendus.reduce((s, e) => s + coutDe(e) * fractionSuspendueEmploye(e), 0);
  const apresSuspension = sousContrat - coutSuspendu;

  // Coût disponible par salarié : le coût ramené à la part d'ETP qui n'est
  // pas suspendue. C'est lui que pèse le pourcentage d'absence CNS.
  const disponible = new Map<string, number>();
  actifs.forEach((e) => {
    const etp = etpDe(e);
    disponible.set(e.code_salarie, etp > 0 ? (coutDe(e) * etpDisponibleDe(e, refDate)) / etp : 0);
  });
  const codes = new Set(actifs.map((e) => e.code_salarie));

  const duMois = <T extends { mois?: number | string | null }>(lignes: T[]) =>
    lignes.filter((l) => Number(l.mois) === mois);

  // --- CNS : chaque salarié pèse son coût DISPONIBLE, pondéré par son % d'absence
  const cnsDuMois = duMois(absencesCns);
  const coutPerduCns = cnsDuMois.reduce(
    (s, a) => s + (nombre(a.pct_absenteisme) / 100) * (disponible.get(a.code_salarie) ?? 0),
    0
  );

  // Coût employeur d'un ETP d'un salarié pour valoriser ses heures d'absence :
  // son brut chargé s'il est dans la photo avec un brut, le repli sinon.
  const brutChargeParCode = new Map<string, number | null>();
  employes.forEach((e) => {
    const brut = source.brutDe(e.code_salarie);
    brutChargeParCode.set(e.code_salarie, brut !== null ? brut * coefDe(e) : null);
  });
  const coutEtpDe = (code: string): number => brutChargeParCode.get(code) ?? coutEtpRepli ?? coutMoyenEtp;
  const coutDesHeures = (lignes: LigneHeures[]) =>
    heuresTravaillables > 0
      ? lignes.reduce((s, a) => s + (nombre(a.duree_hrs) / heuresTravaillables) * coutEtpDe(a.code_salarie), 0)
      : 0;

  // --- MCT : heures converties en ETP, restreintes aux actifs comme dans wp-paliers
  const mctDuMois = duMois(absencesMct).filter((a) => codes.size === 0 || codes.has(a.code_salarie));
  const coutPerduMct = coutDesHeures(mctDuMois);

  // --- Injustifiées : même conversion ; le périmètre est appliqué par l'appelant
  const injDuMois = duMois(absencesInjustifiees);
  const coutPerduInjustifiees = coutDesHeures(injDuMois);

  const apresCns = apresSuspension - coutPerduCns;
  const apresInjustifiees = apresCns - coutPerduInjustifiees; // coût payé
  const apresMct = apresInjustifiees - coutPerduMct; // coût disponible

  const cnsMesure = cnsDuMois.length > 0;
  const mctMesure = mctDuMois.length > 0;
  const injustifieesMesure = injDuMois.length > 0;

  const euro = Math.round;

  return {
    annee,
    mois,
    refDate,
    coef,
    sousContrat: euro(sousContrat),
    coutSuspendu: euro(coutSuspendu),
    apresSuspension: euro(apresSuspension),
    coutPerduCns: euro(coutPerduCns),
    apresCns: euro(apresCns),
    coutPerduInjustifiees: euro(coutPerduInjustifiees),
    apresInjustifiees: euro(apresInjustifiees),
    coutPerduMct: euro(coutPerduMct),
    apresMct: euro(apresMct),
    coutMoyenEtp: euro(coutMoyenEtp),
    etapes: [
      { cle: "effectif-sous-contrat", libelle: "Effectif sous contrat", cout: euro(sousContrat), retire: 0, mesure: true },
      { cle: "effectif-apres-suspension", libelle: "Après suspension de contrat", cout: euro(apresSuspension), retire: euro(coutSuspendu), mesure: true },
      { cle: "taux-cns", libelle: "Après absences CNS", cout: euro(apresCns), retire: euro(coutPerduCns), mesure: cnsMesure },
      { cle: "taux-injustifiees", libelle: "Après absences injustifiées (payé)", cout: euro(apresInjustifiees), retire: euro(coutPerduInjustifiees), mesure: injustifieesMesure },
      { cle: "taux-mct", libelle: "Après MCT (disponible)", cout: euro(apresMct), retire: euro(coutPerduMct), mesure: mctMesure },
    ],
    reporte: { cout: source.reporte, codesManquants },
  };
}

/**
 * Mois REPORTÉ (aucune donnée d'absence) : on applique au coût net (après
 * suspension) les taux ETP repris d'un autre mois, en pourcentage. Chaque
 * taux se rapporte au même dénominateur `net`, comme les taux de la chaîne
 * ETP se rapportent tous à l'effectif après suspension. Un taux null laisse
 * son palier absent (undefined) : rien n'est inventé.
 */
export function appliquerTauxReporte(
  net: number,
  taux: { cns: number | null; inj: number | null; mct: number | null }
): { apresCns?: number; apresInjustifiees?: number; apresMct?: number } {
  const resultat: { apresCns?: number; apresInjustifiees?: number; apresMct?: number } = {};
  if (taux.cns === null) return resultat;
  resultat.apresCns = net * (1 - taux.cns / 100);
  if (taux.inj === null) return resultat;
  resultat.apresInjustifiees = resultat.apresCns - net * (taux.inj / 100);
  if (taux.mct === null) return resultat;
  resultat.apresMct = resultat.apresInjustifiees - net * (taux.mct / 100);
  return resultat;
}
