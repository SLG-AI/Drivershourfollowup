/**
 * Effectif JOUR PAR JOUR : qui est disponible pour travailler chaque jour
 * d'une plage, passée ou future, pour planifier au plus près du besoin.
 *
 * Toutes les autres vues agrègent au mois (fin de mois ou moyenne). Ce module
 * évalue les MÊMES règles un jour à la fois :
 *  - sous contrat : `estActifLe` (entré au plus tard ce jour, pas sorti avant
 *    ce jour ; un sorti en suspension reste dans le système) ;
 *  - suspendu : `isTempExitAt` × `fractionSuspendueEmploye` (0,5 pour un congé
 *    parental à temps partiel par motif, 0 quand le taux le porte déjà). En
 *    têtes, seul un salarié suspendu EN ENTIER cesse de compter ;
 *  - net = sous contrat − suspendus.
 *
 * Absences, retirées du net :
 *  - un mois dont le fichier est importé (passé) : absences CONNUES par
 *    salarié — MCT au jour près, injustifiées sur leur plage de jours ouvrés,
 *    CNS en pourcentage mensuel du salarié (fraction chaque jour, faute de
 *    dates) ;
 *  - un mois sans fichier (futur) : TAUX appliqués au net, fournis par
 *    l'appelant (scénario choisi, sinon historique). La liste d'un jour futur
 *    ne montre donc que des certitudes datées ; les taux restent des nombres.
 *  - congés : aucune donnée datée n'existe ; seul le taux de congés d'un
 *    scénario les retire, passé comme futur.
 *
 * Scénario (facultatif) : les hypothèses gardent leur JOUR — une arrivée le 15
 * compte dès le 15, un départ après son jour, une sortie temporaire de son
 * jour de départ à la veille de son retour. Le turnover, sans date, retire
 * chaque jour futur une fraction du sous contrat (taux annuel ÷ 12, étalé sur
 * les jours du mois, cumulé depuis le premier jour projeté).
 *
 * Tous les jours sont rendus ; samedis, dimanches et fériés sont signalés, les
 * taux s'y appliquent comme en semaine (les chauffeurs roulent aussi).
 */

import { isTempExitAt } from "./wp-calculations";
import { estActifLe } from "./wp-effectif-moyen";
import { fractionSuspendueEmploye } from "./wp-suspension";
import { feriesLuxembourg } from "./wp-variable-attendu";

// ============================================================
// Types
// ============================================================

/** Un salarié tel que la vue le lit : règles d'activité, attributs de filtre et d'affichage. */
export interface PersonneEffectif {
  code_salarie: string;
  nom_salarie?: string | null;
  taux_occupation?: number | null;
  date_entree?: string | null;
  date_sortie?: string | null;
  est_sortie_temporaire: boolean;
  date_debut_sortie_temporaire?: string | null;
  date_fin_sortie_temporaire?: string | null;
  description_motif_sortie?: string | null;
  description_fonction?: string | null;
  description_service?: string | null;
  centre_cout?: string | null;
}

/** Taux d'absence d'un mois sans fichier, en % du net. */
export interface TauxMois {
  cns: number;
  mct: number;
  inj: number;
  conges: number;
}

/** Hypothèse d'un scénario, déjà filtrée sur le périmètre, ramenée à des dates ISO. */
export interface HypotheseJour {
  type: "arrivee" | "depart" | "sortie_temporaire";
  libelle: string;
  nbPersonnes: number;
  /** ETP d'une personne. */
  etp: number;
  /** Arrivée : présente dès ce jour ; départ : dernier jour présent ; sortie temporaire : premier jour absent. */
  debut: string;
  /** Arrivée CDD : dernier jour ; sortie temporaire : jour du retour (présent) ; sinon null. */
  fin: string | null;
}

export interface EntreesEffectifJournalier {
  debut: string;
  fin: string;
  /** Premier jour sans absences connues : les jours à partir de celui-ci sont « futurs » (turnover, taux). */
  premierJourProjete: string;
  /** Population à évaluer pour un mois : sa photo de roster (reconduite à défaut), plus les sortis du mois absents de la photo. */
  populationDuMois: (annee: number, mois: number) => PersonneEffectif[];
  /** Mois dont le fichier est importé, par type d'absence (clé « AAAA-MM »). */
  moisMesures: { cns: Set<string>; mct: Set<string>; inj: Set<string> };
  /** % d'absence CNS du salarié pour un mois mesuré (clé « code|AAAA-MM »). */
  cnsParSalarieMois: Map<string, number>;
  /** Jours de MCT (clé « code|AAAA-MM-JJ »), week-ends écartés. */
  mctJours: Set<string>;
  /** Absences injustifiées, plages de dates. */
  injustifiees: { code_salarie: string; debut: string; fin: string }[];
  /** Taux d'un mois NON mesuré (et taux de congés, qui ne se mesurent jamais). */
  tauxDuMois: (annee: number, mois: number) => TauxMois;
  /** Hypothèses datées du scénario choisi (vide sans scénario). */
  hypotheses?: HypotheseJour[];
  /** Turnover annuel du scénario pour un mois, en % (0 sans scénario). */
  turnoverAnnuel?: (annee: number, mois: number) => number;
  /** Salariés dont un départ est posé par le scénario (hypothèse « issue des données ») : date de sortie remplacée. */
  sortiesScenario?: Map<string, string>;
}

export interface Compte {
  tetes: number;
  etp: number;
}

export interface JourEffectif {
  date: string;
  /** 0 = dimanche … 6 = samedi. */
  jourSemaine: number;
  weekEnd: boolean;
  ferie: boolean;
  /** Jour projeté (absences en taux, turnover) plutôt que mesuré. */
  projete: boolean;
  sousContrat: Compte;
  suspendus: Compte;
  /** Turnover attendu cumulé (jours projetés d'un scénario seulement). */
  turnover: Compte;
  net: Compte;
  absences: { cns: Compte; mct: Compte; inj: Compte; conges: Compte };
  disponibles: Compte;
  /** Mouvements du jour : entrées, sorties, débuts et fins de suspension (salariés et hypothèses). */
  mouvements: { entrees: number; sorties: number };
  /** Réservé au besoin quotidien, à venir. */
  besoin: Compte | null;
}

export type MotifJour =
  | "present"
  | "suspendu"
  | "suspendu_partiel"
  | "mct"
  | "injustifiee"
  | "cns_partiel";

export interface LigneJour {
  code_salarie: string;
  nom_salarie: string | null;
  fonction: string | null;
  depot: string | null;
  etp: number;
  motif: MotifJour;
  /** % CNS du mois (mois mesurés), pour information. */
  cnsMois: number | null;
}

// ============================================================
// Calendrier
// ============================================================

const cleMois = (annee: number, mois: number) => `${annee}-${String(mois).padStart(2, "0")}`;

export function joursEntre(debut: string, fin: string): string[] {
  const jours: string[] = [];
  const d = new Date(`${debut}T00:00:00Z`);
  const f = new Date(`${fin}T00:00:00Z`);
  while (d <= f) {
    jours.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return jours;
}

const feriesCache = new Map<number, Set<string>>();
export function estFerie(date: string): boolean {
  const annee = Number(date.slice(0, 4));
  let s = feriesCache.get(annee);
  if (!s) {
    s = new Set(feriesLuxembourg(annee).map((d) => d.toISOString().slice(0, 10)));
    feriesCache.set(annee, s);
  }
  return s.has(date);
}

const jourSemaineDe = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const joursDansMois = (annee: number, mois: number) => new Date(Date.UTC(annee, mois, 0)).getUTCDate();

/** ISO d'un jour (jour borné au mois), ou null si le mois manque. */
export function dateHypothese(annee: number | null | undefined, mois: number | null | undefined, jour: number | null | undefined): string | null {
  if (!annee || !mois) return null;
  const j = Math.min(Math.max(1, jour || 1), joursDansMois(annee, mois));
  return `${annee}-${String(mois).padStart(2, "0")}-${String(j).padStart(2, "0")}`;
}

// ============================================================
// Règles d'un salarié un jour donné
// ============================================================

function etpDe(p: { taux_occupation?: number | null }): number {
  const t = Number(p.taux_occupation);
  return p.taux_occupation != null && Number.isFinite(t) && t > 0 ? t / 100 : 1;
}

function avecSortieScenario(p: PersonneEffectif, sorties?: Map<string, string>): PersonneEffectif {
  const d = sorties?.get(p.code_salarie);
  return d && (!p.date_sortie || d < p.date_sortie) ? { ...p, date_sortie: d, est_sortie_temporaire: false } : p;
}

interface EtatSalarie {
  actif: boolean;
  /** Fraction de son ETP suspendue ce jour (0 à 1). */
  suspendu: number;
}

function etatLe(p: PersonneEffectif, date: string): EtatSalarie {
  if (!estActifLe(p, date)) return { actif: false, suspendu: 0 };
  return { actif: true, suspendu: isTempExitAt(p, date) ? fractionSuspendueEmploye(p) : 0 };
}

function dansPlage(date: string, debut: string, fin: string | null): boolean {
  return date >= debut && (fin === null || date <= fin);
}

// ============================================================
// Calcul
// ============================================================

const zero = (): Compte => ({ tetes: 0, etp: 0 });
const arrondi = (c: Compte): Compte => ({ tetes: Math.round(c.tetes * 10) / 10, etp: Math.round(c.etp * 10) / 10 });

export function calculerEffectifJournalier(e: EntreesEffectifJournalier): JourEffectif[] {
  const injParCode = new Map<string, { debut: string; fin: string }[]>();
  for (const i of e.injustifiees) injParCode.set(i.code_salarie, [...(injParCode.get(i.code_salarie) ?? []), i]);

  // Survie au turnover : facteur multiplicatif cumulé depuis le premier jour projeté
  let survie = 1;
  const resultat: JourEffectif[] = [];
  let veille: Map<string, EtatSalarie> | null = null;

  for (const date of joursEntre(e.debut, e.fin)) {
    const annee = Number(date.slice(0, 4));
    const mois = Number(date.slice(5, 7));
    const km = cleMois(annee, mois);
    const projete = date >= e.premierJourProjete;
    const jourSemaine = jourSemaineDe(date);
    const weekEnd = jourSemaine === 0 || jourSemaine === 6;

    const sousContrat = zero(), suspendus = zero(), net = zero();
    const abs = { cns: zero(), mct: zero(), inj: zero(), conges: zero() };
    const mouvements = { entrees: 0, sorties: 0 };
    const etats = new Map<string, EtatSalarie>();

    for (const brute of e.populationDuMois(annee, mois)) {
      const p = avecSortieScenario(brute, e.sortiesScenario);
      const et = etatLe(p, date);
      etats.set(p.code_salarie, et);
      if (!et.actif) continue;
      const etp = etpDe(p);
      sousContrat.tetes += 1;
      sousContrat.etp += etp;
      suspendus.etp += etp * et.suspendu;
      if (et.suspendu >= 1) suspendus.tetes += 1;
      const dispo = etp * (1 - et.suspendu);
      const teteDispo = et.suspendu >= 1 ? 0 : 1;
      if (teteDispo === 0) continue;

      // Absences connues des mois mesurés, sur l'ETP disponible
      const mct = e.moisMesures.mct.has(km) && e.mctJours.has(`${p.code_salarie}|${date}`);
      const inj = !mct && e.moisMesures.inj.has(km) && !weekEnd && (injParCode.get(p.code_salarie) ?? []).some((i) => dansPlage(date, i.debut, i.fin));
      if (mct) { abs.mct.tetes += 1; abs.mct.etp += dispo; continue; }
      if (inj) { abs.inj.tetes += 1; abs.inj.etp += dispo; continue; }
      if (e.moisMesures.cns.has(km)) {
        const pct = Math.min(100, e.cnsParSalarieMois.get(`${p.code_salarie}|${km}`) ?? 0) / 100;
        abs.cns.tetes += pct;
        abs.cns.etp += dispo * pct;
      }
    }

    // Hypothèses du scénario, au jour près
    for (const h of e.hypotheses ?? []) {
      const etpTotal = h.nbPersonnes * h.etp;
      if (h.type === "arrivee") {
        if (!dansPlage(date, h.debut, h.fin)) continue;
        sousContrat.tetes += h.nbPersonnes;
        sousContrat.etp += etpTotal;
        if (date === h.debut) mouvements.entrees += h.nbPersonnes;
      } else if (h.type === "depart") {
        if (date <= h.debut) continue;
        sousContrat.tetes -= h.nbPersonnes;
        sousContrat.etp -= etpTotal;
      } else if (dansPlage(date, h.debut, h.fin ? veilleDe(h.fin) : null)) {
        suspendus.tetes += h.nbPersonnes;
        suspendus.etp += etpTotal;
      }
    }

    // Turnover : fraction du sous contrat, cumulée sur les jours projetés
    const turnover = zero();
    if (projete && e.turnoverAnnuel) {
      const tauxJour = e.turnoverAnnuel(annee, mois) / 100 / 12 / joursDansMois(annee, mois);
      survie *= 1 - tauxJour;
      turnover.tetes = sousContrat.tetes * (1 - survie);
      turnover.etp = sousContrat.etp * (1 - survie);
    }

    net.tetes = sousContrat.tetes - suspendus.tetes - turnover.tetes;
    net.etp = sousContrat.etp - suspendus.etp - turnover.etp;

    // Taux : absences d'un mois non mesuré, et congés (jamais mesurés)
    const taux = e.tauxDuMois(annee, mois);
    const parTaux = (pct: number): Compte => ({ tetes: (net.tetes * pct) / 100, etp: (net.etp * pct) / 100 });
    if (!e.moisMesures.cns.has(km)) abs.cns = parTaux(taux.cns);
    if (!e.moisMesures.mct.has(km)) abs.mct = parTaux(taux.mct);
    if (!e.moisMesures.inj.has(km)) abs.inj = parTaux(taux.inj);
    abs.conges = parTaux(taux.conges);

    const retire = (k: keyof Compte) => abs.cns[k] + abs.mct[k] + abs.inj[k] + abs.conges[k];
    const disponibles = { tetes: Math.max(0, net.tetes - retire("tetes")), etp: Math.max(0, net.etp - retire("etp")) };

    // Mouvements de salariés entre la veille et ce jour
    if (veille) {
      etats.forEach((et, code) => {
        const avant = veille!.get(code);
        if (et.actif && avant && !avant.actif) mouvements.entrees += 1;
        if (!et.actif && avant?.actif) mouvements.sorties += 1;
      });
      veille.forEach((avant, code) => {
        if (avant.actif && !etats.has(code)) mouvements.sorties += 1;
      });
    }
    veille = etats;

    resultat.push({
      date,
      jourSemaine,
      weekEnd,
      ferie: estFerie(date),
      projete,
      sousContrat: arrondi(sousContrat),
      suspendus: arrondi(suspendus),
      turnover: arrondi(turnover),
      net: arrondi(net),
      absences: { cns: arrondi(abs.cns), mct: arrondi(abs.mct), inj: arrondi(abs.inj), conges: arrondi(abs.conges) },
      disponibles: arrondi(disponibles),
      mouvements,
      besoin: null,
    });
  }
  return resultat;
}

function veilleDe(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Salariés d'un jour : présents et absents CONNUS, avec leur motif. Les
 * absences en taux (futur, congés) ne désignent personne et n'y figurent pas.
 */
export function listerJour(e: EntreesEffectifJournalier, date: string): LigneJour[] {
  const annee = Number(date.slice(0, 4));
  const mois = Number(date.slice(5, 7));
  const km = cleMois(annee, mois);
  const weekEnd = [0, 6].includes(jourSemaineDe(date));
  const lignes: LigneJour[] = [];
  for (const brute of e.populationDuMois(annee, mois)) {
    const p = avecSortieScenario(brute, e.sortiesScenario);
    const et = etatLe(p, date);
    if (!et.actif) continue;
    const cnsMois = e.moisMesures.cns.has(km) ? e.cnsParSalarieMois.get(`${p.code_salarie}|${km}`) ?? 0 : null;
    let motif: MotifJour = "present";
    if (et.suspendu >= 1) motif = "suspendu";
    else if (e.moisMesures.mct.has(km) && e.mctJours.has(`${p.code_salarie}|${date}`)) motif = "mct";
    else if (e.moisMesures.inj.has(km) && !weekEnd && e.injustifiees.some((i) => i.code_salarie === p.code_salarie && dansPlage(date, i.debut, i.fin))) motif = "injustifiee";
    else if (et.suspendu > 0) motif = "suspendu_partiel";
    else if (cnsMois && cnsMois > 0) motif = "cns_partiel";
    lignes.push({
      code_salarie: p.code_salarie,
      nom_salarie: p.nom_salarie ?? null,
      fonction: p.description_fonction ?? null,
      depot: p.description_service ?? null,
      etp: etpDe(p),
      motif,
      cnsMois,
    });
  }
  return lignes.sort((a, b) => (a.depot ?? "").localeCompare(b.depot ?? "") || (a.fonction ?? "").localeCompare(b.fonction ?? "") || (a.nom_salarie ?? "").localeCompare(b.nom_salarie ?? ""));
}

// ============================================================
// Taux historiques (pour les mois non mesurés)
// ============================================================

export type TauxAbsences = Omit<TauxMois, "conges">;

/**
 * Taux d'absence MESURÉS par mois (« AAAA-MM »), en % du net ETP : somme des
 * ETP absents des jours du mois / somme des ETP nets. Seuls les mois dont le
 * fichier du type est importé portent un taux de ce type.
 */
export function tauxMesuresParMois(jours: JourEffectif[], moisMesures: EntreesEffectifJournalier["moisMesures"]): Map<string, Partial<TauxAbsences>> {
  const sommes = new Map<string, { net: number; cns: number; mct: number; inj: number }>();
  for (const j of jours) {
    const k = j.date.slice(0, 7);
    const s = sommes.get(k) ?? { net: 0, cns: 0, mct: 0, inj: 0 };
    s.net += j.net.etp;
    s.cns += j.absences.cns.etp;
    s.mct += j.absences.mct.etp;
    s.inj += j.absences.inj.etp;
    sommes.set(k, s);
  }
  const taux = new Map<string, Partial<TauxAbsences>>();
  sommes.forEach((s, k) => {
    if (s.net <= 0) return;
    const t: Partial<TauxAbsences> = {};
    if (moisMesures.cns.has(k)) t.cns = (s.cns / s.net) * 100;
    if (moisMesures.mct.has(k)) t.mct = (s.mct / s.net) * 100;
    if (moisMesures.inj.has(k)) t.inj = (s.inj / s.net) * 100;
    taux.set(k, t);
  });
  return taux;
}

/**
 * Taux d'un type pour un mois non mesuré : celui du MÊME mois de l'année
 * précédente s'il est mesuré, sinon la moyenne des 3 derniers mois mesurés,
 * sinon 0.
 */
export function tauxRepris(mesures: Map<string, Partial<TauxAbsences>>, type: keyof TauxAbsences, annee: number, mois: number): number {
  const memeMois = mesures.get(cleMois(annee - 1, mois))?.[type];
  if (memeMois != null) return memeMois;
  const cible = cleMois(annee, mois);
  const anterieurs = [...mesures.entries()]
    .filter(([k, t]) => k < cible && t[type] != null)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-3)
    .map(([, t]) => t[type]!);
  return anterieurs.length > 0 ? anterieurs.reduce((s, v) => s + v, 0) / anterieurs.length : 0;
}

// ============================================================
// Hypothèses d'un scénario
// ============================================================

/** Attributs de périmètre d'une hypothèse. */
export interface AttributsHypothese {
  fonction?: string | null;
  centre_cout?: string | null;
  depot?: string | null;
  type_contrat?: string | null;
}

/** Filtres de périmètre qu'une hypothèse peut porter (les autres ne la concernent pas). */
export interface FiltresHypothese {
  fonctions: string[];
  cc: string[];
  depots: string[];
  contrats: string[];
  /** Un salarié précis est demandé : aucune hypothèse anonyme ne le concerne. */
  employee: string | null;
}

export function hypothesePasseFiltres(h: AttributsHypothese, f: FiltresHypothese): boolean {
  if (f.employee) return false;
  if (f.fonctions.length > 0 && !f.fonctions.includes(h.fonction || "")) return false;
  if (f.cc.length > 0 && !f.cc.includes(h.centre_cout || "")) return false;
  if (f.depots.length > 0 && !f.depots.includes(h.depot || "")) return false;
  if (f.contrats.length > 0 && !f.contrats.includes((h.type_contrat || "").toUpperCase().slice(0, 3))) return false;
  return true;
}

type Ligne = Record<string, unknown>;
const n = (v: unknown) => (v == null || v === "" ? null : Number(v));

/**
 * Lignes brutes des tables d'hypothèses d'UN scénario → hypothèses datées du
 * moteur, plus les départs posés sur un salarié réel (date de sortie
 * remplacée). Les départs « temp_exit… » sont des sorties temporaires sans
 * retour connu.
 */
export function hypothesesDuScenario(
  rows: { arrivees: Ligne[]; sortiesTemporaires: Ligne[]; departs: Ligne[] },
  filtres: FiltresHypothese,
  codesPerimetre: Set<string>
): { hypotheses: HypotheseJour[]; sortiesScenario: Map<string, string> } {
  const hypotheses: HypotheseJour[] = [];
  const sortiesScenario = new Map<string, string>();
  const etp = (r: Ligne) => (n(r.taux_occupation) ?? 100) / 100;

  for (const r of rows.arrivees) {
    if (!hypothesePasseFiltres(r as AttributsHypothese, filtres)) continue;
    const debut = dateHypothese(n(r.start_year), n(r.start_month), n(r.start_day));
    if (!debut) continue;
    const cdd = String(r.type_contrat || "").toUpperCase().startsWith("CDD");
    const finMois = n(r.end_month) ?? n(r.start_month);
    const finAnnee = n(r.end_year) ?? n(r.start_year);
    // Sans jour de fin, un CDD court jusqu'au dernier jour de son mois de fin
    const fin = cdd ? dateHypothese(finAnnee, finMois, n(r.end_day) ?? 31) : null;
    hypotheses.push({ type: "arrivee", libelle: `Arrivée ${cdd ? "CDD" : "CDI"}${r.fonction ? ` — ${r.fonction}` : ""}${r.depot ? ` (${r.depot})` : ""}`, nbPersonnes: n(r.nb_personnes) ?? 1, etp: etp(r), debut, fin });
  }
  for (const r of rows.sortiesTemporaires) {
    if (!hypothesePasseFiltres(r as AttributsHypothese, filtres)) continue;
    const debut = dateHypothese(n(r.departure_year), n(r.departure_month), n(r.departure_day));
    if (!debut) continue;
    hypotheses.push({ type: "sortie_temporaire", libelle: `Sortie temporaire${r.motif ? ` — ${r.motif}` : ""}`, nbPersonnes: n(r.nb_personnes) ?? 1, etp: etp(r), debut, fin: dateHypothese(n(r.return_year), n(r.return_month), n(r.return_day)) });
  }
  for (const r of rows.departs) {
    const date = dateHypothese(n(r.departure_year), n(r.departure_month), n(r.departure_day) ?? 31);
    if (!date) continue;
    const code = r.code_salarie ? String(r.code_salarie) : null;
    const temporaire = String(r.departure_type || "").startsWith("temp_exit");
    if (r.is_from_data && code) {
      if (codesPerimetre.has(code) && !temporaire) sortiesScenario.set(code, date);
      continue;
    }
    if (!hypothesePasseFiltres(r as AttributsHypothese, filtres)) continue;
    hypotheses.push(temporaire
      ? { type: "sortie_temporaire", libelle: "Sortie temporaire (départ)", nbPersonnes: n(r.nb_personnes) ?? 1, etp: etp(r), debut: date, fin: null }
      : { type: "depart", libelle: `Départ${r.fonction ? ` — ${r.fonction}` : ""}`, nbPersonnes: n(r.nb_personnes) ?? 1, etp: etp(r), debut: date, fin: null });
  }
  return { hypotheses, sortiesScenario };
}

/**
 * Taux mensuel d'un scénario : la ligne globale du mois (sans cost center),
 * sinon la moyenne de ses lignes par cost center, sinon null.
 */
export function tauxScenarioDuMois(lignes: Ligne[], colonne: string, mois: number): number | null {
  const duMois = lignes.filter((l) => Number(l.mois) === mois && l[colonne] != null);
  const global = duMois.find((l) => !l.centre_cout);
  if (global) return Number(global[colonne]);
  if (duMois.length === 0) return null;
  return duMois.reduce((s, l) => s + Number(l[colonne]), 0) / duMois.length;
}

/** Congés d'un scénario : réservoir annuel (240 h / 173 h du net) réparti par le taux du mois, en % du net. */
export const CONGES_POOL_ANNUEL = 240 / 173;
