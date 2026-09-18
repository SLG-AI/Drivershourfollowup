/**
 * Contrôle à l'import : une ligne d'absence dure-t-elle plus que la journée
 * contractuelle du salarié ?
 *
 * POURQUOI. Les absences MCT et injustifiées sont converties en ETP par une
 * simple division : heures d'absence / heures travaillables du mois (un mois
 * de TEMPS PLEIN). Il n'y a aucune pondération par l'ETP du salarié, et il n'en
 * faut pas — à condition que le fichier note la journée RÉELLE de l'intéressé
 * (4 h pour un mi-temps, 6,4 h pour un 80 %). Une ligne à 8 h posée sur un
 * mi-temps compterait DOUBLE, en silence : c'est ce qu'on surveille ici.
 *
 * LA RÉFÉRENCE. Le temps de travail n'est JAMAIS déduit du fichier d'absences
 * lui-même, qui est précisément ce qu'on cherche à vérifier. Deux sources, et
 * on retient LA PLUS FAVORABLE des deux :
 *  1. `taux_occupation` du roster (wp_employees) — le taux contractuel ;
 *  2. `tache_pct` des « Statistiques rapides », dé-proratisé (voir plus bas).
 *
 * POURQUOI LA PLUS FAVORABLE, et non l'une ou l'autre. Aucune des deux n'est
 * fiable seule, et les deux se trompent dans des sens opposés :
 *  - `tache_pct` mesure le temps PAYÉ, pas le contrat : un salarié présent tout
 *    le mois mais longuement absent y tombe à 1,6 ou 9,7 alors que son contrat
 *    est à 50 ou 100 %. Il s'effondre donc précisément chez les salariés que ce
 *    contrôle examine ;
 *  - `taux_occupation` est une photographie de FIN de mois : un salarié passé
 *    de 80 % à 50 % en cours d'année y figure à 50 %, alors que ses absences du
 *    début de période valaient encore 6,4 h la journée.
 *
 * Chacune est donc un minorant du taux qui s'appliquait le jour de l'absence.
 * En prendre le maximum revient à ne signaler que ce qu'AUCUNE des deux ne peut
 * justifier. Vérifié sur août 2026 : `tache_pct` seul donnait 9 signalements
 * dont 5 faux et le roster seul 14 faux sur le MCT ; le maximum des deux donne
 * 0 signalement sur 1 560 lignes MCT et 4 sur 31 lignes d'absences
 * injustifiées, tous authentiques.
 *
 * UNE LIGNE N'EST PAS UNE JOURNÉE. Le fichier des absences injustifiées décrit
 * des PÉRIODES (date_debut → date_fin) dont la durée couvre tous les jours
 * ouvrés de l'intervalle : 56 h pour une absence du 4 au 12 août, soit 7 jours
 * ouvrés à 8 h. La durée attendue est donc la journée contractuelle MULTIPLIÉE
 * par le nombre de jours ouvrés de la période — sans quoi toute absence de
 * plus d'un jour serait signalée à tort. Le fichier MCT, lui, donne une ligne
 * par jour.
 *
 * LE PIÈGE. `tache_pct` y est PRORATISÉ par la présence dans le mois : un temps
 * plein entré le 18 d'un mois de 31 jours y figure à 45,16 (= 14/31), pas à
 * 100. Le prendre pour un taux contractuel ferait passer sa journée de 8 h pour
 * un dépassement. On annule donc la proratisation à l'aide des dates d'entrée
 * et de sortie du même fichier — vérifié sur un mois réel : les taux
 * reconstitués retombent sur 100, 80, 55, 50, 37,5… soit les taux du roster.
 */

import { joursOuvresEntre } from "./wp-calculations";

/** Temps de travail de référence d'un salarié pour un mois donné. */
export interface ReferenceTempsTravail {
  code_salarie: string;
  /**
   * Taux CONTRACTUEL du roster, en %. Source à privilégier : il ne dépend ni
   * de la présence ni des absences du mois.
   */
  taux_occupation?: number | string | null;
  /**
   * Taux de tâche des « Statistiques rapides » : proratisé par la présence ET
   * réduit par les absences non payées. Repli seulement.
   */
  tache_pct?: number | string | null;
  date_entree?: string | null;
  date_sortie?: string | null;
}

/** Ligne d'absence à contrôler (MCT ou injustifiée). */
export interface LigneAbsenceAControler {
  code_salarie: string;
  duree_hrs?: number | string | null;
  /** Fichier MCT : le jour de l'absence. Une ligne = un jour. */
  date_absence?: string | null;
  /** Fichier des absences injustifiées : les bornes de la période couverte. */
  date_debut?: string | null;
  date_fin?: string | null;
  mois?: number | string | null;
  annee?: number | string | null;
}

export interface AnomalieDuree {
  code_salarie: string;
  date_absence: string | null;
  /** Durée lue dans le fichier d'absences. */
  duree: number;
  /** Journée contractuelle reconstituée, en heures. */
  journee: number;
  /** Jours ouvrés couverts par la ligne (1 pour une ligne journalière). */
  jours: number;
  /** Durée attendue : journée contractuelle × jours ouvrés. */
  attendu: number;
  /** Taux contractuel reconstitué, en %. */
  taux: number;
}

export interface ResultatControleDurees {
  /** Lignes effectivement comparées. */
  controlees: number;
  /** Lignes non comparées faute de référence pour ce salarié et ce mois. */
  sansReference: number;
  anomalies: AnomalieDuree[];
}

/** Journée conventionnelle d'un temps plein, cohérente avec getWorkableHoursInMonth. */
export const HEURES_JOUR_TEMPS_PLEIN = 8;

/**
 * Tolérance avant de signaler : 10 %.
 *
 * La reconstitution du taux n'est pas exacte au dixième près — une suspension
 * en cours de mois, que les dates d'entrée et de sortie ne portent pas, laisse
 * un taux légèrement sous-évalué (93,6 au lieu de 100). Sans marge, ces
 * salariés seraient signalés à chaque journée normale. Vérifié sur un mois
 * réel : à 10 %, les 1 560 lignes MCT et 27 des 29 lignes d'absences
 * injustifiées passent sans être signalées, et il ne reste que les deux vraies
 * anomalies (une durée de deux jours sur une période n'en comptant qu'un, et
 * des lignes datées un jour non ouvré).
 */
export const TOLERANCE_DUREE = 1.1;

function nombre(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Jours ouvrés couverts par une ligne d'absence.
 *
 * Une ligne du fichier des absences injustifiées porte une période ; celle du
 * fichier MCT porte un seul jour. Une période sans jour ouvré (datée un
 * week-end ou un férié) rend 0 : la ligne est alors invérifiable en l'état et
 * mérite précisément d'être signalée.
 */
export function joursCouverts(ligne: LigneAbsenceAControler): number {
  if (ligne.date_debut && ligne.date_fin) return joursOuvresEntre(ligne.date_debut, ligne.date_fin);
  return 1;
}

/** Nombre de jours calendaires du mois (1-indexé). */
export function joursCalendairesDuMois(annee: number, mois: number): number {
  return new Date(annee, mois, 0).getDate();
}

function iso(annee: number, mois: number, jour: number): string {
  return `${annee}-${String(mois).padStart(2, "0")}-${String(jour).padStart(2, "0")}`;
}

/**
 * Part du mois pendant laquelle le salarié était sous contrat, entre 0 et 1.
 * Les dates hors du mois sont ramenées à ses bornes.
 */
export function partDuMoisPresente(
  ref: ReferenceTempsTravail,
  mois: number,
  annee: number
): number {
  const jours = joursCalendairesDuMois(annee, mois);
  const premier = iso(annee, mois, 1);
  const dernier = iso(annee, mois, jours);

  const entree = ref.date_entree && ref.date_entree > premier ? ref.date_entree : premier;
  const sortie = ref.date_sortie && ref.date_sortie < dernier ? ref.date_sortie : dernier;
  if (entree > sortie) return 0;

  const jourDe = (d: string) => Number(d.slice(8, 10));
  return (jourDe(sortie) - jourDe(entree) + 1) / jours;
}

/**
 * Taux contractuel retenu, en %, ou null si aucune source ne le donne.
 *
 * Maximum des deux sources : le taux du roster d'une part, `tache_pct`
 * débarrassé de sa proratisation par la présence d'autre part. Chacune étant un
 * minorant du taux qui s'appliquait le jour de l'absence, le maximum est le
 * seul choix qui ne fabrique pas de faux positifs (voir l'en-tête du module).
 */
export function tauxContractuel(
  ref: ReferenceTempsTravail,
  mois: number,
  annee: number
): number | null {
  const duRoster = nombre(ref.taux_occupation);

  let desStats = 0;
  const tache = nombre(ref.tache_pct);
  if (tache > 0) {
    const part = partDuMoisPresente(ref, mois, annee);
    if (part > 0) desStats = tache / part;
  }

  const retenu = Math.max(duRoster, desStats);
  return retenu > 0 ? retenu : null;
}

/** Journée contractuelle en heures, ou null si le taux n'est pas calculable. */
export function journeeContractuelle(
  ref: ReferenceTempsTravail,
  mois: number,
  annee: number
): number | null {
  const taux = tauxContractuel(ref, mois, annee);
  if (taux === null) return null;
  return (taux / 100) * HEURES_JOUR_TEMPS_PLEIN;
}

/**
 * Compare chaque ligne d'absence à la journée contractuelle de son salarié.
 *
 * `references` est indexé par `${annee}-${mois}` puis par code salarié : une
 * ligne n'est comparée qu'à la référence de SON mois, car la proratisation
 * dépend du mois.
 */
export function controlerDureesAbsence(
  lignes: LigneAbsenceAControler[],
  references: Map<string, Map<string, ReferenceTempsTravail>>,
  tolerance = TOLERANCE_DUREE
): ResultatControleDurees {
  let controlees = 0;
  let sansReference = 0;
  const anomalies: AnomalieDuree[] = [];

  for (const ligne of lignes) {
    const mois = Number(ligne.mois);
    const annee = Number(ligne.annee);
    const duree = nombre(ligne.duree_hrs);
    if (!(mois >= 1 && mois <= 12) || !(annee > 2000) || duree <= 0) {
      sansReference++;
      continue;
    }

    const ref = references.get(`${annee}-${mois}`)?.get(ligne.code_salarie);
    const journee = ref ? journeeContractuelle(ref, mois, annee) : null;
    if (journee === null || journee <= 0) {
      sansReference++;
      continue;
    }

    controlees++;
    // La durée attendue couvre TOUTE la période de la ligne, pas une journée :
    // une absence du 4 au 12 août vaut 7 jours ouvrés, donc 56 h à temps plein.
    const jours = joursCouverts(ligne);
    const attendu = journee * jours;
    if (duree > attendu * tolerance) {
      anomalies.push({
        code_salarie: ligne.code_salarie,
        date_absence: ligne.date_absence ?? ligne.date_debut ?? null,
        duree,
        journee,
        jours,
        attendu,
        taux: (journee / HEURES_JOUR_TEMPS_PLEIN) * 100,
      });
    }
  }

  // Le dépassement le plus fort d'abord. Une période sans jour ouvré (attendu
  // nul) est le cas le plus aberrant : elle passe en tête.
  const ampleur = (a: AnomalieDuree) => (a.attendu > 0 ? a.duree / a.attendu : Number.POSITIVE_INFINITY);
  anomalies.sort((a, b) => ampleur(b) - ampleur(a));
  return { controlees, sansReference, anomalies };
}

const nf1 = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Messages d'avertissement pour l'écran d'import. Rend un tableau vide quand
 * il n'y a rien à signaler ET que tout a pu être contrôlé.
 */
export function messagesControleDurees(
  r: ResultatControleDurees,
  exemplesMax = 3
): string[] {
  const messages: string[] = [];

  if (r.anomalies.length > 0) {
    const exemples = r.anomalies
      .slice(0, exemplesMax)
      .map((a) =>
        a.attendu > 0
          ? `${a.code_salarie} ${nf1(a.duree)} h au lieu de ${nf1(a.attendu)} h pour ${a.jours} jour${a.jours > 1 ? "s" : ""}`
          : `${a.code_salarie} ${nf1(a.duree)} h sur une période sans jour ouvré`
      )
      .join(" ; ");
    const reste = r.anomalies.length - Math.min(exemplesMax, r.anomalies.length);
    messages.push(
      `${r.anomalies.length} ligne${r.anomalies.length > 1 ? "s" : ""} dépasse${r.anomalies.length > 1 ? "nt" : ""} le temps de travail du salarié sur la période couverte (référence : roster et Statistiques rapides) — ${exemples}${reste > 0 ? `, et ${reste} autre${reste > 1 ? "s" : ""}` : ""}. ` +
        `À vérifier : telles quelles, ces absences pèseront plus que ce que le contrat du salarié permet sur la période.`
    );
  }

  if (r.sansReference > 0) {
    messages.push(
      r.controlees > 0
        ? `${r.sansReference} ligne${r.sansReference > 1 ? "s" : ""} non contrôlée${r.sansReference > 1 ? "s" : ""} : pas de statistiques salariales pour ce salarié sur le mois concerné.`
        : `Durées non contrôlées : aucune statistique salariale importée pour la période. Importez « Statistiques rapides » pour activer ce contrôle.`
    );
  }

  return messages;
}
