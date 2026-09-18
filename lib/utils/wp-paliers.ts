/**
 * Chaîne des paliers d'effectif d'un mois, avec les OPÉRANDES de chaque étape.
 *
 * Le tableau de bord affiche des résultats ; la page de méthodologie doit
 * montrer le chemin qui y mène (numérateur, dénominateur, population retenue).
 * Les deux doivent donner le même chiffre : les définitions vivent donc ici,
 * une seule fois, et le tableau de bord importe `etpDe` / `etpSuspenduDe` /
 * `etpDisponibleDe` au lieu de les redéfinir localement.
 *
 * La chaîne, telle qu'elle est lue de gauche à droite sur le tableau de bord :
 *
 *   sous contrat  −suspensions→  après suspension  −CNS→  après CNS
 *                 −MCT→  après MCT  −injustifiées→  effectif disponible
 *
 * Deux dénominateurs seulement, et ils ne changent jamais d'une étape à
 * l'autre :
 *  - les TAUX (CNS, MCT, injustifiées) se rapportent tous à l'effectif APRÈS
 *    SUSPENSION, jamais au palier précédent. Rapporter le MCT à l'effectif
 *    après CNS gonflerait le taux et le rendrait incomparable d'un mois à
 *    l'autre ;
 *  - les HEURES (MCT, injustifiées) se convertissent en ETP par les heures
 *    travaillables du mois (jours ouvrés luxembourgeois × 8).
 *
 * L'effectif est celui du DERNIER JOUR du mois. La moyenne pondérée par les
 * jours est un autre calcul, dans wp-effectif-moyen.ts.
 */

import { getWorkableHoursInMonth, getWorkingDaysInMonth, isTempExitAt, lastDayOfMonth } from "./wp-calculations";
import { estActifLe } from "./wp-effectif-moyen";
import { fractionSuspendueEmploye } from "./wp-suspension";

/** Salarié d'une photographie de roster, colonnes utiles aux paliers. */
export interface SalariePaliers {
  code_salarie: string;
  taux_occupation?: number | null;
  date_entree?: string | null;
  date_sortie?: string | null;
  est_sortie_temporaire: boolean;
  date_debut_sortie_temporaire?: string | null;
  date_fin_sortie_temporaire?: string | null;
  description_motif_sortie?: string | null;
}

/** Ligne du fichier CNS : un salarié, un mois, un pourcentage d'absence. */
export interface LigneCns {
  code_salarie: string;
  mois?: number | string | null;
  pct_absenteisme?: number | string | null;
  hrs_maladie?: number | string | null;
  hrs_accident?: number | string | null;
  hrs_maternite?: number | string | null;
  hrs_raisons_familiales?: number | string | null;
  hrs_conge_accompagnement?: number | string | null;
  hrs_accueil?: number | string | null;
}

/** Ligne d'absence exprimée en heures (MCT, injustifiées) : une par jour d'absence. */
export interface LigneHeures {
  code_salarie: string;
  mois?: number | string | null;
  duree_hrs?: number | string | null;
}

/**
 * ETP d'un salarié = taux d'occupation / 100.
 * Un taux absent vaut un temps plein : le SIRH ne renseigne la colonne que
 * pour les temps partiels.
 */
export function etpDe(e: SalariePaliers): number {
  return Number(e.taux_occupation || 100) / 100;
}

/**
 * ETP retiré par la suspension de contrat d'un salarié SUSPENDU : son ETP
 * entier, sauf suspension partielle. Voir wp-suspension.ts — un congé parental
 * à temps partiel encodé par le taux retire 0, sa réduction étant déjà portée
 * par `taux_occupation`.
 *
 * Ne dit RIEN de l'état du salarié à une date : à combiner avec `isTempExitAt`.
 */
export function etpSuspenduDe(e: SalariePaliers): number {
  return etpDe(e) * fractionSuspendueEmploye(e);
}

/**
 * ETP réellement disponible à une date = ETP moins la part suspendue.
 * C'est LUI qui porte les absences et les heures travaillables : un salarié en
 * congé parental ne peut pas être malade au sens du taux d'absentéisme.
 */
export function etpDisponibleDe(e: SalariePaliers, date: string): number {
  return isTempExitAt(e, date) ? etpDe(e) - etpSuspenduDe(e) : etpDe(e);
}

/** Une étape de la chaîne, telle qu'elle s'affiche sur la page de méthodologie. */
export interface EtapePalier {
  /** Ancre d'URL et clé de rendu. */
  cle: string;
  libelle: string;
  /** Effectif au terme de l'étape, en ETP. */
  etp: number;
  /** ETP retiré PAR cette étape (0 pour l'étape de départ). */
  retire: number;
  /** Taux associé en %, rapporté à l'effectif après suspension. null quand l'étape n'en a pas. */
  taux: number | null;
  /** false quand le mois n'a aucune donnée pour cette étape : le palier est alors inchangé. */
  mesure: boolean;
}

export interface PaliersMois {
  annee: number;
  mois: number;
  /** Dernier jour du mois : la date à laquelle tout l'effectif est constaté. */
  refDate: string;

  /** Nombre de PERSONNES sous contrat (à distinguer des ETP). */
  headcount: number;
  /** Jours ouvrés du mois (lun-ven hors 11 fériés luxembourgeois). */
  joursOuvres: number;
  /** Heures travaillables = jours ouvrés × 8. Dénominateur des taux horaires. */
  heuresTravaillables: number;

  sousContrat: number;
  /** ETP retiré par les suspensions de contrat en cours. */
  etpSuspendu: number;
  /** Nombre de salariés en suspension de contrat (personnes, pas ETP). */
  nbSuspendus: number;
  apresSuspension: number;

  /** Heures d'absence CNS du mois, tous motifs confondus. Sert d'ordre de grandeur, PAS au calcul du taux. */
  heuresCns: number;
  etpPerduCns: number;
  tauxCns: number;
  cnsMesure: boolean;
  apresCns: number;

  heuresMct: number;
  etpPerduMct: number;
  tauxMct: number;
  mctMesure: boolean;
  apresMct: number;

  heuresInjustifiees: number;
  etpPerduInjustifiees: number;
  tauxInjustifiees: number;
  injustifieesMesure: boolean;
  apresInjustifiees: number;

  /** Somme des trois taux : le « taux d'absentéisme global » du tableau de bord. */
  tauxGlobal: number;

  etapes: EtapePalier[];
}

function nombre(v: unknown): number {
  return Number(v || 0);
}

/** Heures d'absence CNS d'une ligne, tous motifs confondus. */
export function heuresCnsDeLaLigne(a: LigneCns): number {
  return (
    nombre(a.hrs_maladie) +
    nombre(a.hrs_accident) +
    nombre(a.hrs_maternite) +
    nombre(a.hrs_raisons_familiales) +
    nombre(a.hrs_conge_accompagnement) +
    nombre(a.hrs_accueil)
  );
}

/**
 * Déroule la chaîne des paliers pour un mois.
 *
 * `employes` est la PHOTOGRAPHIE du mois, déjà filtrée par le périmètre et
 * déjà passée par `reclassifierSortiesTemporaires` — exactement la liste dont
 * part le tableau de bord.
 *
 * `absencesMct` doit avoir été débarrassée des week-ends (`horsWeekEnd`) :
 * le dénominateur ne compte que du lundi au vendredi.
 *
 * Les absences injustifiées ne sont PAS restreintes aux salariés de la photo,
 * à l'identique du tableau de bord : le fichier peut concerner un salarié sorti
 * depuis, et ces heures ont bien manqué au mois.
 */
export function calculerPaliers(
  employes: SalariePaliers[],
  absencesCns: LigneCns[],
  absencesMct: LigneHeures[],
  absencesInjustifiees: LigneHeures[],
  mois: number,
  annee: number
): PaliersMois {
  const refDate = lastDayOfMonth(annee, mois);
  const joursOuvres = getWorkingDaysInMonth(annee, mois);
  const heuresTravaillables = getWorkableHoursInMonth(annee, mois);

  const actifs = employes.filter((e) => estActifLe(e, refDate));
  const sousContrat = actifs.reduce((s, e) => s + etpDe(e), 0);

  const suspendus = actifs.filter((e) => isTempExitAt(e, refDate));
  const etpSuspendu = suspendus.reduce((s, e) => s + etpSuspenduDe(e), 0);
  const apresSuspension = sousContrat - etpSuspendu;

  // ETP disponible par salarié : le dénominateur de tous les taux, et le
  // poids de chacun dans le taux CNS.
  const disponible = new Map<string, number>();
  actifs.forEach((e) => disponible.set(e.code_salarie, etpDisponibleDe(e, refDate)));
  const codes = new Set(actifs.map((e) => e.code_salarie));

  const duMois = <T extends { mois?: number | string | null }>(lignes: T[]) =>
    lignes.filter((l) => Number(l.mois) === mois);

  // --- CNS : chaque salarié pèse son ETP DISPONIBLE, pondéré par son % d'absence
  const cnsDuMois = duMois(absencesCns);
  const etpPerduCns = cnsDuMois.reduce(
    (s, a) => s + (nombre(a.pct_absenteisme) / 100) * (disponible.get(a.code_salarie) ?? 0),
    0
  );
  // Heures affichées à côté du taux : MÊME population que le numérateur, sinon
  // la carte montrerait un pourcentage et un volume d'heures qui ne se
  // correspondent pas. Sont donc écartées les lignes des salariés suspendus
  // (ETP disponible nul) et celles dont le pourcentage d'absence est nul.
  const heuresCns = cnsDuMois
    .filter((a) => (disponible.get(a.code_salarie) ?? 0) > 0 && nombre(a.pct_absenteisme) > 0)
    .reduce((s, a) => s + heuresCnsDeLaLigne(a), 0);

  // --- MCT : heures converties en ETP par les heures travaillables
  const mctDuMois = duMois(absencesMct).filter((a) => codes.size === 0 || codes.has(a.code_salarie));
  const heuresMct = mctDuMois.reduce((s, a) => s + nombre(a.duree_hrs), 0);
  const etpPerduMct = heuresTravaillables > 0 ? heuresMct / heuresTravaillables : 0;

  // --- Injustifiées : même conversion, sans restriction de périmètre
  const injDuMois = duMois(absencesInjustifiees);
  const heuresInjustifiees = injDuMois.reduce((s, a) => s + nombre(a.duree_hrs), 0);
  const etpPerduInjustifiees = heuresTravaillables > 0 ? heuresInjustifiees / heuresTravaillables : 0;

  // Un seul dénominateur pour les trois taux : l'effectif après suspension.
  const enPourcent = (etpPerdu: number) => (apresSuspension > 0 ? (etpPerdu / apresSuspension) * 100 : 0);
  const tauxCns = enPourcent(etpPerduCns);
  const tauxMct = enPourcent(etpPerduMct);
  const tauxInjustifiees = enPourcent(etpPerduInjustifiees);

  const apresCns = apresSuspension - etpPerduCns;
  const apresMct = apresCns - etpPerduMct;
  const apresInjustifiees = apresMct - etpPerduInjustifiees;

  const cnsMesure = cnsDuMois.length > 0;
  const mctMesure = mctDuMois.length > 0;
  const injustifieesMesure = injDuMois.length > 0;

  return {
    annee,
    mois,
    refDate,
    headcount: actifs.length,
    joursOuvres,
    heuresTravaillables,
    sousContrat,
    etpSuspendu,
    nbSuspendus: suspendus.length,
    apresSuspension,
    heuresCns,
    etpPerduCns,
    tauxCns,
    cnsMesure,
    apresCns,
    heuresMct,
    etpPerduMct,
    tauxMct,
    mctMesure,
    apresMct,
    heuresInjustifiees,
    etpPerduInjustifiees,
    tauxInjustifiees,
    injustifieesMesure,
    apresInjustifiees,
    tauxGlobal: tauxCns + tauxMct + tauxInjustifiees,
    etapes: [
      { cle: "effectif-sous-contrat", libelle: "Effectif sous contrat", etp: sousContrat, retire: 0, taux: null, mesure: true },
      { cle: "effectif-apres-suspension", libelle: "Après suspension de contrat", etp: apresSuspension, retire: etpSuspendu, taux: null, mesure: true },
      { cle: "taux-cns", libelle: "Après absences CNS", etp: apresCns, retire: etpPerduCns, taux: tauxCns, mesure: cnsMesure },
      { cle: "taux-mct", libelle: "Après MCT", etp: apresMct, retire: etpPerduMct, taux: tauxMct, mesure: mctMesure },
      { cle: "taux-injustifiees", libelle: "Après absences injustifiées", etp: apresInjustifiees, retire: etpPerduInjustifiees, taux: tauxInjustifiees, mesure: injustifieesMesure },
    ],
  };
}
