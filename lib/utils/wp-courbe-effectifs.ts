/**
 * Courbe d'évolution des effectifs : les douze points de l'année, en ETP.
 *
 * POURQUOI ICI. Ce calcul vivait en ligne dans le tableau de bord, refermé sur
 * ses variables locales. La page Coûts trace les mêmes paliers en euros et
 * doit partir des mêmes points (mêmes photos, mêmes taux repris, mêmes
 * drapeaux de report) : le calcul est donc extrait tel quel, sans en changer
 * une règle. Le tableau de bord l'appelle et relit ce qu'il lisait avant
 * (taux repris, taux CNS du mois affiché, point de départ des projections).
 *
 * RÈGLES, inchangées :
 *  - chaque mois se lit dans SA photo de roster, reconduite à défaut
 *    (`photoDuMoisDe`, fourni par l'appelant déjà filtré et reclassifié) ;
 *  - net = sous contrat − ETP suspendu ; réel = net − CNS (ETP disponible ×
 *    pourcentage d'absence) ; payé = réel − injustifiées ; disponible = payé
 *    − MCT. Les heures se convertissent par les heures travaillables du mois ;
 *  - un mois sans fichier d'absence reprend le DERNIER taux connu (l'année
 *    précédente amorce une année future) et se trace en pointillé ;
 *  - `taux_appliques` garde le taux effectivement utilisé, mesuré ou repris :
 *    c'est ce que la page Coûts applique à sa propre chaîne.
 */

import type { HeadcountDataPoint } from "@/components/workforce/headcount-evolution-chart";
import { FRENCH_MONTHS_SHORT } from "@/lib/constants";
import { getWorkableHoursInMonth, horsWeekEnd, isTempExitAt, lastDayOfMonth } from "./wp-calculations";
import { computeEffectifMoyen, estActifLe, paliersEnMoyenne, type SortiHorsPhoto } from "./wp-effectif-moyen";
import { etpDe, etpDisponibleDe, etpSuspenduDe, injustifieesDuPerimetre, type LigneCns, type LigneHeures, type SalariePaliers } from "./wp-paliers";

export interface MoisAnnee {
  mois: number;
  annee: number;
}

/** Taux repris d'un mois antérieur (en %), avec le mois d'où il vient. */
export interface TauxRepris extends MoisAnnee {
  taux: number;
}

export interface EntreesCourbe {
  selectedYear: number;
  selectedMonth: number;
  now: Date;
  /** L'année affichée est postérieure à l'année en cours. */
  anneeFuture: boolean;
  /** Un filtre de périmètre est actif (règle des absences injustifiées). */
  filtresActifs: boolean;
  /** Somme des besoins cibles, 0 sans cible. */
  targetTotal: number;
  /** Photo d'un mois, déjà filtrée et reclassifiée ; reconduite si le mois n'a pas la sienne. */
  photoDuMoisDe: (mois: number, annee: number) => SalariePaliers[];
  /** Le mois a SA propre photo de roster. */
  photoExacte: (mois: number, annee: number) => boolean;
  /** Sortis du mois absents de la photo (voir computeEffectifMoyen), vide si non calculable. */
  sortisHorsPhotoPour: (mois: number) => SortiHorsPhoto[];
  /** Absences de l'année affichée : CNS (plafonnées), MCT hors week-end, injustifiées (avant périmètre). */
  absences: LigneCns[];
  mctHorsWeekEnd: LigneHeures[];
  absencesInjustifiees: LigneHeures[];
  /** Année précédente, pour amorcer les taux d'une année future (MCT brut : les week-ends sont écartés ici). */
  absencesAnneePrec: LigneCns[];
  mctAnneePrec: (LigneHeures & { date_absence?: string | null })[];
  injAnneePrec: LigneHeures[];
}

export interface SortieCourbe {
  headcountData: HeadcountDataPoint[];
  /** Mois à projeter, du 1er mois après le mois courant à décembre de l'année affichée. */
  etapesProjection: MoisAnnee[];
  /** Point de départ des projections de scénario. */
  departProjection: { brut: number; net: number };
  /** Derniers taux connus après la boucle (ceux que les KPI et les scénarios reprennent). */
  tauxRepris: { cns: TauxRepris | null; mct: TauxRepris | null; inj: TauxRepris | null };
  /** Taux CNS du mois affiché (mesuré ou repris), en %. */
  avgAbsenteeism: number;
  /** Mois d'origine du taux CNS du mois affiché quand il est repris, null s'il est mesuré. */
  cnsEstimatedFromMonth: MoisAnnee | null;
}

const arrondi1 = (n: number) => Math.round(n * 10) / 10;

export function construireCourbeEffectifs(e: EntreesCourbe): SortieCourbe {
  const { selectedYear, selectedMonth, now, anneeFuture, filtresActifs, targetTotal } = e;
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const actifsParmi = (liste: SalariePaliers[], date: string) => liste.filter((s) => estActifLe(s, date));

  const headcountData: HeadcountDataPoint[] = [];
  let lastKnownCnsRate: number | null = null;
  let lastKnownMctRate: number | null = null;
  let lastKnownInjRate: number | null = null;
  // Mois d'origine des taux repris, pour signaler une valeur estimée dans les KPI
  let lastKnownCnsMonth: MoisAnnee | null = null;
  let lastKnownMctMonth: MoisAnnee | null = null;
  let lastKnownInjMonth: MoisAnnee | null = null;
  let cnsEstimatedFromMonth: MoisAnnee | null = null;
  let avgAbsenteeism = 0;

  // Mois à projeter : du 1er mois après le dernier mois réel jusqu'à décembre
  // de l'année affichée. Une année future s'enchaîne ainsi aux mois restants
  // de l'année en cours (turnover, arrivées, sorties temporaires des
  // scénarios) au lieu de repartir de la dernière photo.
  const etapesProjection: MoisAnnee[] = [];
  if (selectedYear >= currentYear) {
    for (let y = currentYear; y <= selectedYear; y++) {
      for (let m = 1; m <= 12; m++) {
        if (y === currentYear && m <= currentMonth) continue;
        etapesProjection.push({ annee: y, mois: m });
      }
    }
  }

  // Année future : amorcer les taux CNS / MCT / injustifiées avec le dernier
  // mois connu de l'année précédente, calculé comme dans la boucle ci-dessous
  // (photo du mois reconduite, ETP disponible, heures travaillables).
  if (anneeFuture) {
    const anneePrec = selectedYear - 1;
    const mctPrecHorsWeekEnd = horsWeekEnd(e.mctAnneePrec);
    for (let m = 12; m >= 1; m--) {
      if (lastKnownCnsRate !== null && lastKnownMctRate !== null && lastKnownInjRate !== null) break;
      const monthEnd = lastDayOfMonth(anneePrec, m);
      const actifs = actifsParmi(e.photoDuMoisDe(m, anneePrec), monthEnd);
      const dispo = new Map<string, number>();
      actifs.forEach((s) => dispo.set(s.code_salarie, etpDisponibleDe(s, monthEnd)));
      const net = [...dispo.values()].reduce((a, b) => a + b, 0);
      const workable = getWorkableHoursInMonth(anneePrec, m);
      if (net <= 0 || workable <= 0) continue;
      const cnsMois = e.absencesAnneePrec.filter((a) => Number(a.mois) === m);
      if (lastKnownCnsRate === null && cnsMois.length > 0) {
        const absent = cnsMois.reduce((sum, a) => sum + (Number(a.pct_absenteisme || 0) / 100) * (dispo.get(a.code_salarie) ?? 0), 0);
        lastKnownCnsRate = (absent / net) * 100;
        lastKnownCnsMonth = { mois: m, annee: anneePrec };
      }
      const mctMois = mctPrecHorsWeekEnd.filter((a) => Number(a.mois) === m && dispo.has(a.code_salarie));
      if (lastKnownMctRate === null && mctMois.length > 0) {
        const fte = mctMois.reduce((sum, a) => sum + Number(a.duree_hrs || 0), 0) / workable;
        lastKnownMctRate = (fte / net) * 100;
        lastKnownMctMonth = { mois: m, annee: anneePrec };
      }
      // Même règle de périmètre que l'année affichée (voir injustifieesDuPerimetre)
      const injMois = injustifieesDuPerimetre(
        e.injAnneePrec.filter((a) => Number(a.mois) === m),
        filtresActifs,
        new Set(dispo.keys())
      );
      if (lastKnownInjRate === null && injMois.length > 0) {
        const fte = injMois.reduce((sum, a) => sum + Number(a.duree_hrs || 0), 0) / workable;
        lastKnownInjRate = (fte / net) * 100;
        lastKnownInjMonth = { mois: m, annee: anneePrec };
      }
    }
  }

  for (let m = 1; m <= 12; m++) {
    const monthEnd = lastDayOfMonth(selectedYear, m);
    const isProjection = selectedYear > currentYear || (selectedYear === currentYear && m > currentMonth);

    // Chaque mois dans sa propre photo (voir photoDuMoisDe)
    const photoDuMois = e.photoDuMoisDe(m, selectedYear);
    const photoExacte = e.photoExacte(m, selectedYear);
    const activeAtMonth = actifsParmi(photoDuMois, monthEnd);
    const codesDuMois = new Set(activeAtMonth.map((s) => s.code_salarie));

    const brutEtpAtMonth = activeAtMonth.reduce((sum, s) => sum + etpDe(s), 0);
    const tempExitsAtMonth = activeAtMonth.filter((s) => isTempExitAt(s, monthEnd));
    const tempExitsEtp = tempExitsAtMonth.reduce((sum, s) => sum + etpSuspenduDe(s), 0);
    const netEtpAtMonth = brutEtpAtMonth - tempExitsEtp;

    // Moyenne du mois pondérée par les jours, pour la vue « Moyenne » de la
    // courbe : même calcul que les cartes KPI. Les sortis du mois absents de
    // la photo viennent de l'appelant (voir sortisHorsPhotoPour).
    const moyenneDuMois = computeEffectifMoyen(photoDuMois, e.sortisHorsPhotoPour(m), m, selectedYear);

    // Effectif réel après maladie
    // Grâce à la reclassification, les employés maladie CNS ne sont plus
    // comptés comme sorties temporaires → ils font partie de l'effectif net
    // On calcule leur impact maladie individuellement (pct_absenteisme * taux_occupation)
    let absentEtp: number;

    // Absences de l'année entière : celles d'un salarié absent de la photo
    // affichée comptent pour les mois où il figurait. Le rattachement à
    // l'effectif se fait plus bas par l'ETP disponible (0 hors photo du mois).
    const monthAbs = e.absences.filter((a) => Number(a.mois) === m);
    const hasAbsenceData = monthAbs.length > 0;

    let effectifReel: number;
    if (hasAbsenceData) {
      // L'absence porte sur l'ETP DISPONIBLE : entier pour qui travaille, nul
      // pour une suspension complète, la part restante pour une partielle.
      const empEtpDisponible = new Map<string, number>();
      activeAtMonth.forEach((s) => empEtpDisponible.set(s.code_salarie, etpDisponibleDe(s, monthEnd)));

      absentEtp = monthAbs.reduce((sum, a) => {
        const etp = empEtpDisponible.get(a.code_salarie) ?? 0;
        return sum + (Number(a.pct_absenteisme || 0) / 100) * etp;
      }, 0);
      effectifReel = netEtpAtMonth - absentEtp;
      // Mémoriser le dernier taux CNS connu
      if (netEtpAtMonth > 0) {
        lastKnownCnsRate = (absentEtp / netEtpAtMonth) * 100;
        lastKnownCnsMonth = { mois: m, annee: selectedYear };
      }
    } else {
      // Pas de données réelles CNS → appliquer le dernier taux CNS connu
      const cnsRate = lastKnownCnsRate ?? 0;
      absentEtp = netEtpAtMonth * (cnsRate / 100);
      effectifReel = netEtpAtMonth - absentEtp;
    }
    const tauxCnsApplique = netEtpAtMonth > 0 ? (absentEtp / netEtpAtMonth) * 100 : lastKnownCnsRate;

    // Capturer le taux d'absentéisme pour le mois sélectionné
    if (m === selectedMonth && netEtpAtMonth > 0) {
      avgAbsenteeism = (absentEtp / netEtpAtMonth) * 100;
      // Sans données réelles, la valeur ci-dessus est le dernier taux CNS connu
      cnsEstimatedFromMonth = hasAbsenceData ? null : lastKnownCnsMonth;
    }

    // Chaîne du mois : réel (après CNS) −injustifiées→ PAYÉ −MCT→ DISPONIBLE.
    // Une absence CNS ou injustifiée n'est pas payée ; un salarié en MCT l'est
    // (remboursement partiel par la mutuelle ensuite). Voir wp-paliers.ts.

    // Effectif payé = effectif réel - FTE perdus par absences injustifiées
    const monthInj = injustifieesDuPerimetre(
      e.absencesInjustifiees.filter((a) => Number(a.mois) === m),
      filtresActifs,
      codesDuMois
    );
    let effectifApresInjustifiees: number | undefined;
    let projectedApresInjustifiees: number | undefined;
    let ftePerdusInjMois = 0;
    let tauxInjApplique: number | null = null;
    if (monthInj.length > 0) {
      const totalInjHrs = monthInj.reduce((sum, a) => sum + Number(a.duree_hrs || 0), 0);
      const workableHrs = getWorkableHoursInMonth(selectedYear, m);
      ftePerdusInjMois = workableHrs > 0 ? totalInjHrs / workableHrs : 0;
      effectifApresInjustifiees = Math.max(0, arrondi1(effectifReel - ftePerdusInjMois));
      // Mémoriser le dernier taux connu, même dénominateur que le mois réel
      if (netEtpAtMonth > 0) {
        lastKnownInjRate = (ftePerdusInjMois / netEtpAtMonth) * 100;
        lastKnownInjMonth = { mois: m, annee: selectedYear };
      }
      tauxInjApplique = netEtpAtMonth > 0 ? (ftePerdusInjMois / netEtpAtMonth) * 100 : lastKnownInjRate;
    } else if (lastKnownInjRate !== null) {
      // Projeter avec le dernier taux connu (affiché en pointillé)
      ftePerdusInjMois = netEtpAtMonth * (lastKnownInjRate / 100);
      projectedApresInjustifiees = Math.max(0, arrondi1(effectifReel - ftePerdusInjMois));
      tauxInjApplique = lastKnownInjRate;
    }

    // Effectif disponible = effectif payé - FTE perdus par maladies court terme non CNS
    // Même règle que allAbsencesMct, mais sur les salariés de la photo du mois
    const monthMct = e.mctHorsWeekEnd.filter((a) => Number(a.mois) === m && (codesDuMois.size === 0 || codesDuMois.has(a.code_salarie)));
    let effectifApresMct: number | undefined;
    let projectedApresMct: number | undefined;
    // Base des scénarios : ils ne modélisent PAS les injustifiées, leur point
    // de départ reste donc réel − MCT, comme avant le réordonnancement.
    let baseScenarioApresMct: number | undefined;
    let tauxMctApplique: number | null = null;
    if (monthMct.length > 0) {
      const totalMctHrs = monthMct.reduce((sum, a) => sum + Number(a.duree_hrs || 0), 0);
      const workableHrs = getWorkableHoursInMonth(selectedYear, m);
      const ftePerdus = workableHrs > 0 ? totalMctHrs / workableHrs : 0;
      const disponible = Math.max(0, arrondi1(effectifReel - ftePerdusInjMois - ftePerdus));
      // MCT mesuré mais injustifiées ESTIMÉES : le disponible l'est en partie
      // aussi, il se trace donc en pointillé comme toute valeur reprise.
      if (monthInj.length === 0 && ftePerdusInjMois > 0) projectedApresMct = disponible;
      else effectifApresMct = disponible;
      baseScenarioApresMct = Math.max(0, arrondi1(effectifReel - ftePerdus));
      // Mémoriser le dernier taux MCT connu.
      // Même dénominateur que le calcul du mois réel (heures MCT / heures
      // travaillables ajustées), soit ftePerdus / effectif net — et non
      // l'effectif après CNS, qui gonflerait le taux repris.
      if (netEtpAtMonth > 0) {
        lastKnownMctRate = (ftePerdus / netEtpAtMonth) * 100;
        lastKnownMctMonth = { mois: m, annee: selectedYear };
      }
      tauxMctApplique = netEtpAtMonth > 0 ? (ftePerdus / netEtpAtMonth) * 100 : lastKnownMctRate;
    } else if (lastKnownMctRate !== null) {
      // Projeter avec le dernier taux MCT connu (affiché en pointillé)
      const ftePerdus = netEtpAtMonth * (lastKnownMctRate / 100);
      projectedApresMct = Math.max(0, arrondi1(effectifReel - ftePerdusInjMois - ftePerdus));
      tauxMctApplique = lastKnownMctRate;
    }

    headcountData.push({
      month: FRENCH_MONTHS_SHORT[m],
      effectif_brut: arrondi1(brutEtpAtMonth),
      effectif_net: Math.max(0, arrondi1(netEtpAtMonth)),
      effectif_reel: Math.max(0, arrondi1(effectifReel)),
      effectif_apres_mct: effectifApresMct,
      projected_apres_mct: projectedApresMct,
      base_scenario_apres_mct: baseScenarioApresMct,
      moyenne_brute: { brut: moyenneDuMois.brut, net: moyenneDuMois.net },
      effectif_apres_injustifiees: effectifApresInjustifiees,
      projected_apres_injustifiees: projectedApresInjustifiees,
      is_projection: isProjection,
      target: targetTotal > 0 ? targetTotal : undefined,
      // Valeurs REPORTÉES (tracées en pointillé) : photo reconduite d'un autre
      // mois, ou taux d'absence repris du dernier mois connu. Un palier hérite
      // du report de ses entrées.
      reporte: (() => {
        const brut = !photoExacte;
        const reel = brut || !hasAbsenceData;
        const injustifiees = reel || monthInj.length === 0;
        const mct = injustifiees || monthMct.length === 0;
        return { brut, net: brut, reel, injustifiees, mct };
      })(),
      taux_appliques: { cns: tauxCnsApplique, inj: tauxInjApplique, mct: tauxMctApplique },
    });
  }

  // Vue « Moyenne » de la courbe : chaque point de fin de mois, une fois les
  // jonctions posées, exprimé en moyenne du mois (voir paliersEnMoyenne).
  headcountData.forEach((d) => {
    if (d.moyenne_brute) d.moyenne = paliersEnMoyenne(d, d.moyenne_brute);
  });

  // Point de départ des projections de scénario : le dernier mois réel de
  // l'année affichée, ou, pour une année future, la fin du mois courant lue
  // dans la dernière photo (reconduite).
  const departProjection = (() => {
    const lastRealIdx = headcountData.findIndex((d) => d.is_projection) - 1;
    if (lastRealIdx >= 0) {
      return { brut: headcountData[lastRealIdx].effectif_brut, net: headcountData[lastRealIdx].effectif_net };
    }
    if (anneeFuture) {
      const monthEnd = lastDayOfMonth(currentYear, currentMonth);
      const actifs = actifsParmi(e.photoDuMoisDe(currentMonth, currentYear), monthEnd);
      const brut = actifs.reduce((sum, s) => sum + etpDe(s), 0);
      const suspendu = actifs.filter((s) => isTempExitAt(s, monthEnd)).reduce((sum, s) => sum + etpSuspenduDe(s), 0);
      return { brut: arrondi1(brut), net: arrondi1(brut - suspendu) };
    }
    const dernier = headcountData[headcountData.length - 1];
    return { brut: dernier.effectif_brut, net: dernier.effectif_net };
  })();

  const repris = (taux: number | null, mois: MoisAnnee | null): TauxRepris | null =>
    taux !== null && mois !== null ? { taux, ...mois } : null;

  return {
    headcountData,
    etapesProjection,
    departProjection,
    tauxRepris: {
      cns: repris(lastKnownCnsRate, lastKnownCnsMonth),
      mct: repris(lastKnownMctRate, lastKnownMctMonth),
      inj: repris(lastKnownInjRate, lastKnownInjMonth),
    },
    avgAbsenteeism,
    cnsEstimatedFromMonth,
  };
}
