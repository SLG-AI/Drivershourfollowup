/**
 * Analyse de l'absentéisme : taux global (CNS + MCT + injustifiées) par mois
 * et par dépôt, et score de Bradford individuel.
 *
 * Mêmes définitions que le tableau de bord, appliquées mois par mois sur la
 * photo du mois (voir roster-photos.ts) :
 * - CNS : Σ pct_absenteisme × ETP disponible des actifs non suspendus ;
 * - MCT : heures hors week-end / heures travaillables du mois, en ETP ;
 * - injustifiées : heures / heures travaillables, en ETP ;
 * - dénominateur : ETP disponible (sous contrat − suspensions) ;
 * - année = Σ des pertes / Σ des ETP disponibles sur les mois qui ont des données.
 *
 * Bradford = S² × D sur l'année : S = épisodes d'absence, D = jours absents.
 * Épisodes : suites de jours MCT (un trou ≤ 3 jours ne coupe pas, le week-end
 * ne compte pas), chaque absence injustifiée, et chaque suite de mois avec
 * des jours maladie CNS. Jours : lignes MCT, heures injustifiées / 8, jours
 * maladie CNS.
 */

import {
  actifsEnFinDeMois,
  estJourDeWeekEnd,
  getWorkableHoursInMonth,
  isTempExitAt,
  lastDayOfMonth,
  type SalariePhoto,
} from "./wp-calculations";
import { photoPourLeMois, type PhotosParRang } from "./roster-photos";
import { fractionSuspendueEmploye, reclassifierSortiesTemporaires } from "./wp-suspension";

export const SEUIL_CLASSEMENT_DEPOT_ETP = 10;
export const DEPOT_NON_RENSEIGNE = "Non renseigné";
export const NB_BRADFORD = 25;

export interface LignePhotoAbsence extends SalariePhoto {
  mois: number | string;
  annee: number | string;
  taux_occupation?: number | string | null;
  description_service?: string | null;
  nom_salarie?: string | null;
  date_debut_sortie_temporaire?: string | null;
}

export interface AbsenceCns {
  code_salarie: string;
  mois: number | string;
  annee: number | string;
  pct_absenteisme: number | string | null;
  hrs_maladie?: number | string | null;
  jours_maladie?: number | string | null;
}

export interface AbsenceMct {
  code_salarie: string;
  nom_salarie?: string | null;
  date_absence?: string | null;
  duree_hrs: number | string | null;
  mois: number | string;
  annee: number | string;
}

export interface AbsenceInjustifiee {
  code_salarie: string;
  nom_salarie?: string | null;
  date_debut?: string | null;
  date_fin?: string | null;
  duree_hrs: number | string | null;
  mois: number | string;
  annee: number | string;
}

export interface TauxAbsenteisme {
  cns: number;
  mct: number;
  injustifiees: number;
  global: number;
}

export interface AbsenteismeDepot extends TauxAbsenteisme {
  depot: string;
  /** ETP disponible moyen sur les mois avec données */
  netEtpMoyen: number;
  heuresMct: number;
  heuresInjustifiees: number;
  classable: boolean;
}

export interface ScoreBradford {
  code_salarie: string;
  nom: string;
  depot: string;
  /** Plus sous contrat à la dernière photo connue */
  parti: boolean;
  episodes: number;
  jours: number;
  joursCns: number;
  score: number;
}

export interface AbsenteismeAnnee {
  annee: number;
  /** Mois couverts qui ont au moins une donnée d'absence */
  moisAvecDonnees: number[];
  netEtpMoyen: number;
  taux: TauxAbsenteisme;
  parMois: ({ mois: number } & TauxAbsenteisme)[];
  /** Classables d'abord, puis du taux global le plus fort au plus faible */
  parDepot: AbsenteismeDepot[];
  bradford: ScoreBradford[];
}

const n = (v: number | string | null | undefined) => Number(v || 0);
const arrondi1 = (x: number) => Math.round(x * 10) / 10;
const pct = (num: number, den: number) => (den > 0 ? arrondi1((num / den) * 100) : 0);
const etpDe = (e: { taux_occupation?: number | string | null }) => n(e.taux_occupation ?? 100) / 100 || 1;
const depotDe = (e: { description_service?: string | null }) => e.description_service || DEPOT_NON_RENSEIGNE;

interface Pertes { net: number; cns: number; mct: number; inj: number; hMct: number; hInj: number }
const pertesVides = (): Pertes => ({ net: 0, cns: 0, mct: 0, inj: 0, hMct: 0, hInj: 0 });
const ajouter = (a: Pertes, b: Pertes) => {
  a.net += b.net; a.cns += b.cns; a.mct += b.mct; a.inj += b.inj; a.hMct += b.hMct; a.hInj += b.hInj;
};
const tauxDe = (p: Pertes): TauxAbsenteisme => ({
  cns: pct(p.cns, p.net),
  mct: pct(p.mct, p.net),
  injustifiees: pct(p.inj, p.net),
  global: pct(p.cns + p.mct + p.inj, p.net),
});

/** Dernière fiche connue de chaque salarié, toutes photos confondues. */
function dernieresFiches<T extends LignePhotoAbsence>(photos: PhotosParRang<T>): { fiches: Map<string, T>; dernierRang: number | null } {
  const fiches = new Map<string, T>();
  const rangs = [...photos.keys()].sort((a, b) => a - b);
  rangs.forEach((r) => (photos.get(r) ?? []).forEach((e) => fiches.set(e.code_salarie, e)));
  return { fiches, dernierRang: rangs.length > 0 ? rangs[rangs.length - 1] : null };
}

export function analyserAbsenteisme<T extends LignePhotoAbsence>(
  annee: number,
  moisCouverts: number[],
  photos: PhotosParRang<T>,
  cns: AbsenceCns[],
  mct: AbsenceMct[],
  injustifiees: AbsenceInjustifiee[]
): AbsenteismeAnnee {
  const cnsAnnee = cns.filter((a) => Number(a.annee) === annee);
  const mctAnnee = mct.filter((a) => Number(a.annee) === annee && !estJourDeWeekEnd(a.date_absence));
  const injAnnee = injustifiees.filter((a) => Number(a.annee) === annee);
  const codesAvecMaladieCns = new Set(cnsAnnee.filter((a) => n(a.hrs_maladie) > 0).map((a) => a.code_salarie));
  const { fiches, dernierRang } = dernieresFiches(photos);
  const depotConnu = (code: string) => { const f = fiches.get(code); return f ? depotDe(f) : DEPOT_NON_RENSEIGNE; };

  const total = pertesVides();
  const parDepotCumul = new Map<string, Pertes>();
  const netParDepotParMois = new Map<string, number[]>();
  const parMois: ({ mois: number } & TauxAbsenteisme)[] = [];
  const moisAvecDonnees: number[] = [];

  moisCouverts.forEach((m) => {
    const cnsMois = cnsAnnee.filter((a) => Number(a.mois) === m);
    const mctMois = mctAnnee.filter((a) => Number(a.mois) === m);
    const injMois = injAnnee.filter((a) => Number(a.mois) === m);
    if (cnsMois.length === 0 && mctMois.length === 0 && injMois.length === 0) return;
    moisAvecDonnees.push(m);

    const monthEnd = lastDayOfMonth(annee, m);
    const photo = reclassifierSortiesTemporaires(photoPourLeMois(photos, m, annee).lignes.map((e) => ({ ...e })), codesAvecMaladieCns);
    const actifs = actifsEnFinDeMois(photo, monthEnd);
    const workable = getWorkableHoursInMonth(annee, m);

    // ETP disponible et dépôt de chaque actif
    const dispo = new Map<string, number>();
    const depotDuMois = new Map<string, string>();
    const pertesMois = new Map<string, Pertes>();
    actifs.forEach((e) => {
      const etp = etpDe(e);
      const d = isTempExitAt(e, monthEnd) ? etp - etp * fractionSuspendueEmploye(e) : etp;
      dispo.set(e.code_salarie, d);
      depotDuMois.set(e.code_salarie, depotDe(e));
      const p = pertesMois.get(depotDe(e)) ?? pertesVides();
      p.net += d;
      pertesMois.set(depotDe(e), p);
    });
    // CNS : rattachée par code aux actifs (0 hors photo ou suspension complète)
    cnsMois.forEach((a) => {
      const d = dispo.get(a.code_salarie) ?? 0;
      if (d <= 0) return;
      const p = pertesMois.get(depotDuMois.get(a.code_salarie)!)!;
      p.cns += (n(a.pct_absenteisme) / 100) * d;
    });
    // MCT : même filtre que le tableau de bord (salariés de la photo)
    mctMois.forEach((a) => {
      if (!dispo.has(a.code_salarie)) return;
      const p = pertesMois.get(depotDuMois.get(a.code_salarie)!)!;
      p.hMct += n(a.duree_hrs);
      if (workable > 0) p.mct += n(a.duree_hrs) / workable;
    });
    // Injustifiées : pas de filtre roster (comme le tableau de bord), dépôt = dernier connu
    injMois.forEach((a) => {
      const depot = depotDuMois.get(a.code_salarie) ?? depotConnu(a.code_salarie);
      const p = pertesMois.get(depot) ?? pertesVides();
      p.hInj += n(a.duree_hrs);
      if (workable > 0) p.inj += n(a.duree_hrs) / workable;
      pertesMois.set(depot, p);
    });

    const totalMois = pertesVides();
    pertesMois.forEach((p, depot) => {
      ajouter(totalMois, p);
      const cumul = parDepotCumul.get(depot) ?? pertesVides();
      ajouter(cumul, p);
      parDepotCumul.set(depot, cumul);
      if (!netParDepotParMois.has(depot)) netParDepotParMois.set(depot, []);
      netParDepotParMois.get(depot)!.push(p.net);
    });
    ajouter(total, totalMois);
    parMois.push({ mois: m, ...tauxDe(totalMois) });
  });

  const nbMois = moisAvecDonnees.length;
  const parDepot: AbsenteismeDepot[] = [...parDepotCumul.entries()].map(([depot, p]) => {
    const nets = netParDepotParMois.get(depot) ?? [];
    // Moyenne sur les mois avec données (0 les mois où le dépôt est absent)
    const netEtpMoyen = nbMois > 0 ? nets.reduce((a, b) => a + b, 0) / nbMois : 0;
    return {
      depot,
      netEtpMoyen: arrondi1(netEtpMoyen),
      heuresMct: Math.round(p.hMct),
      heuresInjustifiees: Math.round(p.hInj),
      ...tauxDe(p),
      classable: netEtpMoyen >= SEUIL_CLASSEMENT_DEPOT_ETP,
    };
  }).sort((a, b) => Number(b.classable) - Number(a.classable) || b.global - a.global || b.netEtpMoyen - a.netEtpMoyen);

  return {
    annee,
    moisAvecDonnees,
    netEtpMoyen: arrondi1(nbMois > 0 ? total.net / nbMois : 0),
    taux: tauxDe(total),
    parMois,
    parDepot,
    bradford: calculerBradford(annee, cnsAnnee, mctAnnee, injAnnee, fiches, dernierRang),
  };
}

/** Épisodes parmi des dates ISO triées : un trou de plus de `tolerance` jours ouvre un nouvel épisode. */
export function compterEpisodes(datesISO: string[], tolerance = 3): number {
  const jours = [...new Set(datesISO.map((d) => d.slice(0, 10)))].sort();
  let episodes = 0;
  let precedent: number | null = null;
  jours.forEach((d) => {
    const t = Date.parse(`${d}T00:00:00Z`);
    if (precedent === null || (t - precedent) / 86400000 > tolerance) episodes += 1;
    precedent = t;
  });
  return episodes;
}

function calculerBradford<T extends LignePhotoAbsence>(
  annee: number,
  cns: AbsenceCns[],
  mct: AbsenceMct[],
  inj: AbsenceInjustifiee[],
  fiches: Map<string, T>,
  dernierRang: number | null
): ScoreBradford[] {
  interface Cumul { datesMct: string[]; episodesInj: number; joursInj: number; moisCns: Set<number>; joursCns: number; nom?: string | null }
  const parCode = new Map<string, Cumul>();
  const cumul = (code: string) => {
    let c = parCode.get(code);
    if (!c) { c = { datesMct: [], episodesInj: 0, joursInj: 0, moisCns: new Set(), joursCns: 0 }; parCode.set(code, c); }
    return c;
  };
  mct.forEach((a) => {
    if (!a.date_absence) return;
    const c = cumul(a.code_salarie);
    c.datesMct.push(String(a.date_absence));
    c.nom = c.nom || a.nom_salarie;
  });
  inj.forEach((a) => {
    const c = cumul(a.code_salarie);
    c.episodesInj += 1;
    c.joursInj += n(a.duree_hrs) / 8;
    c.nom = c.nom || a.nom_salarie;
  });
  cns.forEach((a) => {
    const jours = a.jours_maladie != null && a.jours_maladie !== "" ? n(a.jours_maladie) : n(a.hrs_maladie) / 8;
    if (jours <= 0) return;
    const c = cumul(a.code_salarie);
    c.moisCns.add(Number(a.mois));
    c.joursCns += jours;
  });

  const finDernierePhoto = dernierRang === null ? null : lastDayOfMonth(Math.floor((dernierRang - 1) / 12), ((dernierRang - 1) % 12) + 1);
  const derniersCodes = new Set<string>();
  fiches.forEach((f, code) => {
    const rangFiche = Number(f.annee) * 12 + Number(f.mois);
    if (rangFiche === dernierRang) derniersCodes.add(code);
  });

  return [...parCode.entries()].map(([code, c]) => {
    const episodesCns = compterEpisodesMois([...c.moisCns]);
    const joursMct = new Set(c.datesMct.map((d) => d.slice(0, 10))).size;
    const episodes = compterEpisodes(c.datesMct) + c.episodesInj + episodesCns;
    const jours = joursMct + c.joursInj + c.joursCns;
    const fiche = fiches.get(code);
    const parti = !fiche
      || !derniersCodes.has(code)
      || Boolean(fiche.date_sortie && finDernierePhoto && fiche.date_sortie <= finDernierePhoto && !fiche.est_sortie_temporaire);
    return {
      code_salarie: code,
      nom: fiche?.nom_salarie || c.nom || code,
      depot: fiche ? depotDe(fiche) : DEPOT_NON_RENSEIGNE,
      parti,
      episodes,
      jours: arrondi1(jours),
      joursCns: arrondi1(c.joursCns),
      score: Math.round(episodes * episodes * jours),
    };
  })
    .filter((b) => b.score > 0)
    .sort((a, b) => b.score - a.score || b.episodes - a.episodes)
    .slice(0, NB_BRADFORD);
}

/** Suites de mois consécutifs = épisodes (maladie longue durée CNS). */
export function compterEpisodesMois(mois: number[]): number {
  const tries = [...new Set(mois)].sort((a, b) => a - b);
  let episodes = 0;
  tries.forEach((m, i) => { if (i === 0 || m !== tries[i - 1] + 1) episodes += 1; });
  return episodes;
}
