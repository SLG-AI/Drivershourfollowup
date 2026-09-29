/**
 * Variable lié au planning : réalisé des mois payés, ATTENDU des mois suivants.
 *
 * Chaque nature variable est payée le mois SUIVANT l'événement qui la
 * déclenche (vérifié sur la paie 2026) : la paie de M reflète le mois M − 1.
 * D'où une projection par déclencheur, recalée à chaque import de paie :
 *
 *  - dimanches (SHD) : taux par dimanche × dimanches de M − 1 ;
 *  - fériés (HFM)    : taux par férié × fériés de M − 1, pondérés selon le
 *                      jour (un férié de samedi ou de dimanche mobilise moins
 *                      de services qu'un férié de semaine ; fourchette large,
 *                      l'historique n'en contient presque pas) ;
 *  - nuits, amplitudes, dépannages et permanences : sans calendrier visible,
 *                      moyenne des derniers mois, fourchette min–max ;
 *  - heures sup. (HSM) : après une fin de période de référence (avril, août,
 *                      décembre), € par heure × (heures payées du mois + solde
 *                      positif du compteur) ; les autres mois, moyenne ;
 *  - 6e jours (PRR)  : payés en fin de période, 80 € le jour. Le nombre de
 *                      jours n'est pas dans les données : il est estimé par le
 *                      compteur de jours du règlement appliqué aux heures, calé
 *                      sur les périodes déjà payées, puis ramené vers la
 *                      moyenne historique au prorata de la corrélation
 *                      salarié par salarié (faible tant que les jours réels ne
 *                      sont pas importés).
 */

import { regrouperPetitsGroupes } from "./wp-anonymisation";

export const PRIME_6E_JOUR = 80;
/** Plafond du compteur de jours supplémentaires ; les jours au-delà sont dus aussi, payés en fin de période. */
export const PLAFOND_COMPTEUR_JOURS = 5;
const MOIS_MOYENNE_DIMANCHES = 4;
const MOIS_MOYENNE_STABLES = 6;

export type PosteVariable = "dimanches" | "feries" | "nuits" | "amplitudes" | "depannages" | "heures_sup" | "sixiemes_jours";

export const POSTES_VARIABLES: { id: PosteVariable; libelle: string; natures: `nat_${string}`[] }[] = [
  { id: "dimanches", libelle: "Dimanches", natures: ["nat_shd"] },
  { id: "feries", libelle: "Jours fériés", natures: ["nat_hfm"] },
  { id: "nuits", libelle: "Nuits", natures: ["nat_shn"] },
  { id: "amplitudes", libelle: "Amplitudes", natures: ["nat_am1", "nat_am2"] },
  { id: "depannages", libelle: "Dépannages et permanences", natures: ["nat_pr_d", "nat_perm"] },
  { id: "heures_sup", libelle: "Heures sup. majorées", natures: ["nat_hsm"] },
  { id: "sixiemes_jours", libelle: "Primes de 6e jour", natures: ["nat_prr"] },
];

/** Une ligne de paie, natures comprises (wp_salary_lines). */
export interface LignePaieVariable {
  code_salarie: string;
  mois: number | string;
  annee: number | string;
  [nature: `nat_${string}`]: unknown;
}

/** Un mois du fichier d'heures d'un conducteur (monthly_records + drivers.code_salarie). */
export interface HeuresMois {
  code_salarie: string;
  annee: number;
  mois: number;
  buffer_hours: number;
  positive_hours: number;
  missing_hours: number;
  overtime_pay: number;
  counter_end: number;
}

export interface CelluleVariable {
  montant: number;
  /** Fourchette, sur les seules cellules estimées qui en ont une. */
  bas?: number;
  haut?: number;
}

export interface MoisVariable {
  mois: number;
  estime: boolean;
  postes: Record<PosteVariable, CelluleVariable>;
  total: number;
  bas: number;
  haut: number;
  /** Ce qui déclenche la paie de ce mois (mois précédent), pour les mois estimés. */
  declencheurs: string[];
}

export interface ProjectionVariable {
  annee: number;
  dernierMoisPaie: number | null;
  mois: MoisVariable[];
  /** Hypothèses chiffrées, par poste, recalculées sur l'historique importé. */
  hypotheses: Record<PosteVariable, string>;
}

// ============================================================
// Calendrier
// ============================================================

const NOMS_MOIS = ["", "janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

function paques(annee: number): Date {
  // Algorithme de Meeus/Jones/Butcher (calendrier grégorien)
  const a = annee % 19, b = Math.floor(annee / 100), c = annee % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31), jour = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(annee, mois - 1, jour));
}

const decaler = (d: Date, jours: number) => new Date(d.getTime() + jours * 86_400_000);

/** Jours fériés légaux luxembourgeois d'une année (dont la Journée de l'Europe, depuis 2019). */
export function feriesLuxembourg(annee: number): Date[] {
  const p = paques(annee);
  const fixe = (m: number, j: number) => new Date(Date.UTC(annee, m - 1, j));
  return [
    fixe(1, 1), decaler(p, 1), fixe(5, 1), fixe(5, 9), decaler(p, 39), decaler(p, 50),
    fixe(6, 23), fixe(8, 15), fixe(11, 1), fixe(12, 25), fixe(12, 26),
  ].sort((a, b) => a.getTime() - b.getTime());
}

export function dimanchesDuMois(annee: number, mois: number): number {
  const jours = new Date(Date.UTC(annee, mois, 0)).getUTCDate();
  let n = 0;
  for (let j = 1; j <= jours; j++) if (new Date(Date.UTC(annee, mois - 1, j)).getUTCDay() === 0) n++;
  return n;
}

function joursOuvres(annee: number, mois: number): number {
  const jours = new Date(Date.UTC(annee, mois, 0)).getUTCDate();
  let n = 0;
  for (let j = 1; j <= jours; j++) {
    const js = new Date(Date.UTC(annee, mois - 1, j)).getUTCDay();
    if (js !== 0 && js !== 6) n++;
  }
  return n;
}

/** Poids d'un férié selon son jour : [central, bas, haut]. Semaine = 1. */
const POIDS_FERIE: Record<"semaine" | "samedi" | "dimanche", [number, number, number]> = {
  semaine: [1, 1, 1],
  samedi: [0.85, 0.6, 1],
  dimanche: [0.65, 0.4, 0.9],
};

function feriesDuMois(annee: number, mois: number): { central: number; bas: number; haut: number; jours: Date[] } {
  const jours = feriesLuxembourg(annee).filter((d) => d.getUTCMonth() === mois - 1);
  const r = { central: 0, bas: 0, haut: 0, jours };
  for (const d of jours) {
    const js = d.getUTCDay();
    const [c, b, h] = POIDS_FERIE[js === 6 ? "samedi" : js === 0 ? "dimanche" : "semaine"];
    r.central += c; r.bas += b; r.haut += h;
  }
  return r;
}

/** Mois précédent (M − 1), année comprise. */
const precedent = (annee: number, mois: number) => (mois === 1 ? { annee: annee - 1, mois: 12 } : { annee, mois: mois - 1 });
const estFinDePeriode = (mois: number) => mois % 4 === 0;

// ============================================================
// Heures et 6e jours
// ============================================================

const nombre = (v: unknown) => {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
};
const moyenne = (xs: number[]) => (xs.length > 0 ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

function correlation(x: number[], y: number[]): number | null {
  if (x.length < 3) return null;
  const mx = moyenne(x), my = moyenne(y);
  let sxy = 0, sx = 0, sy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sx += (x[i] - mx) ** 2;
    sy += (y[i] - my) ** 2;
  }
  return sx > 0 && sy > 0 ? sxy / Math.sqrt(sx * sy) : null;
}

/** Heures d'une fin de période : heures payées du mois + solde positif du compteur. */
function heuresDecompte(heures: HeuresMois[], annee: number, mois: number): number | null {
  const duMois = heures.filter((h) => h.annee === annee && h.mois === mois);
  if (duMois.length === 0) return null;
  return duMois.reduce((s, h) => s + nombre(h.overtime_pay) + Math.max(nombre(h.counter_end), 0), 0);
}

/**
 * Jours de 6e jour estimés par conducteur pour la période qui finit en
 * (annee, moisFin) : chaque mois, le solde d'heures converti en jours (heures
 * théoriques du jour = colonne 10 % × 10 / jours ouvrés) alimente le compteur,
 * plancher 0 ; au-delà de 5 les jours sont dus ; le solde final aussi.
 * Null si un mois de la période manque au fichier d'heures.
 */
export function joursSixiemeEstimes(heures: HeuresMois[], annee: number, moisFin: number): Map<string, number> | null {
  const moisPeriode = [moisFin - 3, moisFin - 2, moisFin - 1, moisFin];
  const parCode = new Map<string, HeuresMois[]>();
  for (const h of heures) {
    if (h.annee !== annee || !moisPeriode.includes(h.mois)) continue;
    parCode.set(h.code_salarie, [...(parCode.get(h.code_salarie) ?? []), h]);
  }
  const moisPresents = new Set([...parCode.values()].flat().map((h) => h.mois));
  if (moisPeriode.some((m) => !moisPresents.has(m))) return null;

  const jours = new Map<string, number>();
  parCode.forEach((lignes, code) => {
    let compteur = 0;
    let dus = 0;
    for (const h of [...lignes].sort((a, b) => a.mois - b.mois)) {
      const heuresJour = (nombre(h.buffer_hours) * 10) / joursOuvres(h.annee, h.mois);
      // Un tampon aberrant (ex. 776 h) fausserait la conversion : ligne ignorée
      if (!(heuresJour > 0 && heuresJour < 12)) continue;
      compteur = Math.max(0, compteur + (nombre(h.positive_hours) - nombre(h.missing_hours)) / heuresJour);
      if (compteur > PLAFOND_COMPTEUR_JOURS) {
        dus += compteur - PLAFOND_COMPTEUR_JOURS;
        compteur = PLAFOND_COMPTEUR_JOURS;
      }
    }
    jours.set(code, dus + compteur);
  });
  return jours;
}

// ============================================================
// Projection
// ============================================================

export function projeterVariable(p: { annee: number; lignesPaie: LignePaieVariable[]; heures: HeuresMois[] }): ProjectionVariable {
  const { annee, heures } = p;
  const lignes = p.lignesPaie.filter((l) => Number(l.annee) === annee);

  // Réel par mois et par poste, et par salarié pour les 6e jours
  const reel = new Map<number, Record<PosteVariable, number>>();
  const prrParCode = new Map<number, Map<string, number>>();
  for (const l of lignes) {
    const m = Number(l.mois);
    const r = reel.get(m) ?? (Object.fromEntries(POSTES_VARIABLES.map((x) => [x.id, 0])) as Record<PosteVariable, number>);
    for (const poste of POSTES_VARIABLES) for (const n of poste.natures) r[poste.id] += nombre(l[n]);
    reel.set(m, r);
    const prr = nombre(l.nat_prr);
    if (prr !== 0) {
      const parCode = prrParCode.get(m) ?? new Map<string, number>();
      parCode.set(l.code_salarie, (parCode.get(l.code_salarie) ?? 0) + prr);
      prrParCode.set(m, parCode);
    }
  }
  const observes = [...reel.keys()].sort((a, b) => a - b);
  const dernierMoisPaie = observes.length > 0 ? observes[observes.length - 1] : null;
  const derniers = (n: number, filtre: (m: number) => boolean = () => true) => observes.filter(filtre).slice(-n);

  // ---- Dimanches : taux par dimanche du mois précédent
  const tauxDimanche = moyenne(derniers(MOIS_MOYENNE_DIMANCHES).map((m) => {
    const t = precedent(annee, m);
    return reel.get(m)!.dimanches / dimanchesDuMois(t.annee, t.mois);
  }));

  // ---- Fériés : taux par férié pondéré du mois précédent
  let sommeHfm = 0, sommePoids = 0;
  for (const m of observes) {
    const t = precedent(annee, m);
    const f = feriesDuMois(t.annee, t.mois);
    if (f.central > 0) { sommeHfm += reel.get(m)!.feries; sommePoids += f.central; }
  }
  const tauxFerie = sommePoids > 0 ? sommeHfm / sommePoids : 0;

  // ---- Postes stables
  const stable = (poste: PosteVariable) => {
    const valeurs = derniers(MOIS_MOYENNE_STABLES).map((m) => reel.get(m)![poste]);
    return { montant: moyenne(valeurs), bas: Math.min(...valeurs), haut: Math.max(...valeurs) };
  };

  // ---- Heures sup. : € par heure de décompte, et moyenne hors décompte
  const tauxHeures: number[] = [];
  const decomptesHsm: number[] = [];
  for (const m of observes) {
    const t = precedent(annee, m);
    if (!estFinDePeriode(t.mois)) continue;
    decomptesHsm.push(reel.get(m)!.heures_sup);
    const h = heuresDecompte(heures, t.annee, t.mois);
    if (h && h > 0) tauxHeures.push(reel.get(m)!.heures_sup / h);
  }
  const horsDecompte = derniers(MOIS_MOYENNE_STABLES, (m) => !estFinDePeriode(precedent(annee, m).mois)).map((m) => reel.get(m)!.heures_sup);

  // ---- 6e jours : calage du modèle d'heures sur les périodes déjà payées
  const calages: { ratio: number; r: number | null; reel: number }[] = [];
  for (const m of observes) {
    const t = precedent(annee, m);
    if (!estFinDePeriode(t.mois)) continue;
    const modele = joursSixiemeEstimes(heures, t.annee, t.mois);
    // Paiement de fin de période, et ses éventuels rattrapages du mois suivant
    const paye = new Map<string, number>();
    for (const mm of [m, m + 1]) prrParCode.get(mm)?.forEach((v, code) => paye.set(code, (paye.get(code) ?? 0) + v / PRIME_6E_JOUR));
    const reelJours = [...paye.values()].reduce((s, v) => s + v, 0);
    if (!modele || reelJours <= 0) continue;
    const totalModele = [...modele.values()].reduce((s, v) => s + v, 0);
    if (totalModele <= 0) continue;
    const codes = [...modele.keys()];
    calages.push({
      ratio: reelJours / totalModele,
      r: correlation(codes.map((c) => modele.get(c)!), codes.map((c) => paye.get(c) ?? 0)),
      reel: reelJours,
    });
  }
  const ratioMoyen = moyenne(calages.map((c) => c.ratio));
  const rs = calages.map((c) => c.r).filter((r): r is number => r !== null);
  const rMoyen = Math.max(0, Math.min(1, moyenne(rs)));
  const moyenneJours = moyenne(calages.map((c) => c.reel));

  // ---- Mois
  const mois: MoisVariable[] = [];
  for (let m = 1; m <= 12; m++) {
    const r = reel.get(m);
    if (r) {
      const postes = Object.fromEntries(POSTES_VARIABLES.map((x) => [x.id, { montant: r[x.id] }])) as Record<PosteVariable, CelluleVariable>;
      const total = Object.values(r).reduce((s, v) => s + v, 0);
      mois.push({ mois: m, estime: false, postes, total, bas: total, haut: total, declencheurs: [] });
      continue;
    }
    // Seuls les mois APRÈS le dernier mois payé sont estimés
    if (dernierMoisPaie === null || m < dernierMoisPaie) continue;

    const t = precedent(annee, m);
    const nomT = NOMS_MOIS[t.mois];
    const declencheurs: string[] = [];
    const postes = {} as Record<PosteVariable, CelluleVariable>;

    const dimanches = dimanchesDuMois(t.annee, t.mois);
    postes.dimanches = { montant: tauxDimanche * dimanches };
    declencheurs.push(`${dimanches} dimanches en ${nomT}`);

    const f = feriesDuMois(t.annee, t.mois);
    postes.feries = { montant: tauxFerie * f.central, bas: tauxFerie * f.bas, haut: tauxFerie * f.haut };
    if (f.jours.length > 0) {
      const jourSemaine = (d: Date) => ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"][d.getUTCDay()];
      declencheurs.push(`férié${f.jours.length > 1 ? "s" : ""} : ${f.jours.map((d) => `${jourSemaine(d)} ${d.getUTCDate()}`).join(", ")}`);
    }

    postes.nuits = stable("nuits");
    postes.amplitudes = stable("amplitudes");
    postes.depannages = stable("depannages");

    if (estFinDePeriode(t.mois)) {
      declencheurs.push(`décompte de fin de période (${NOMS_MOIS[t.mois - 3]}–${nomT})`);
      const h = heuresDecompte(heures, t.annee, t.mois);
      if (h !== null && tauxHeures.length > 0) {
        postes.heures_sup = { montant: moyenne(tauxHeures) * h, bas: Math.min(...tauxHeures) * h, haut: Math.max(...tauxHeures) * h };
      } else {
        postes.heures_sup = { montant: moyenne(decomptesHsm), bas: Math.min(...decomptesHsm, 0), haut: Math.max(...decomptesHsm, 0) };
      }
      const modele = joursSixiemeEstimes(heures, t.annee, t.mois);
      if (modele && calages.length > 0) {
        const cale = ratioMoyen * [...modele.values()].reduce((s, v) => s + v, 0);
        const jours = rMoyen * cale + (1 - rMoyen) * moyenneJours;
        postes.sixiemes_jours = { montant: jours * PRIME_6E_JOUR, bas: Math.min(jours, cale) * PRIME_6E_JOUR, haut: Math.max(jours, cale) * PRIME_6E_JOUR };
      } else {
        postes.sixiemes_jours = { montant: moyenneJours * PRIME_6E_JOUR };
      }
    } else {
      postes.heures_sup = horsDecompte.length > 0
        ? { montant: moyenne(horsDecompte), bas: Math.min(...horsDecompte), haut: Math.max(...horsDecompte) }
        : { montant: 0 };
      postes.sixiemes_jours = { montant: 0 };
    }

    const cellules = Object.values(postes);
    mois.push({
      mois: m,
      estime: true,
      postes,
      total: cellules.reduce((s, c) => s + c.montant, 0),
      bas: cellules.reduce((s, c) => s + (c.bas ?? c.montant), 0),
      haut: cellules.reduce((s, c) => s + (c.haut ?? c.montant), 0),
      declencheurs,
    });
  }

  const euros = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} €`;
  const nbMois = (n: number) => `${n} mois`;
  const hypotheses: Record<PosteVariable, string> = {
    dimanches: `${euros(tauxDimanche)} par dimanche du mois précédent (moyenne des ${nbMois(derniers(MOIS_MOYENNE_DIMANCHES).length)} payés les plus récents).`,
    feries: `${euros(tauxFerie)} par férié de semaine du mois précédent ; un samedi compte 0,85 (0,6 à 1), un dimanche 0,65 (0,4 à 0,9) — peu d'historique pour ces jours-là.`,
    nuits: `Moyenne des ${nbMois(derniers(MOIS_MOYENNE_STABLES).length)} payés les plus récents, fourchette min–max.`,
    amplitudes: "Amplitudes > 11 h et > 12 h : moyenne récente, fourchette min–max.",
    depannages: "Moyenne récente, fourchette min–max.",
    heures_sup: tauxHeures.length > 0
      ? `Après une fin de période : ${euros(moyenne(tauxHeures))} par heure (heures payées du mois + solde positif du compteur) ; sinon moyenne des mois hors décompte.`
      : "Moyenne des décomptes et des mois hors décompte déjà payés (fichier d'heures absent).",
    sixiemes_jours: calages.length > 0
      ? `${PRIME_6E_JOUR} € par jour, payés en fin de période. Jours estimés par le compteur appliqué aux heures, calé à ${ratioMoyen.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} sur ${calages.length} période${calages.length > 1 ? "s" : ""} payée${calages.length > 1 ? "s" : ""}, pondéré par la corrélation (r = ${rMoyen.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}) et ramené vers la moyenne historique (${Math.round(moyenneJours).toLocaleString("fr-FR")} jours) : à fiabiliser avec les jours réalisés.`
      : `${PRIME_6E_JOUR} € par jour, payés en fin de période ; aucune période payée pour caler l'estimation.`,
  };

  return { annee, dernierMoisPaie, mois, hypotheses };
}

// ============================================================
// Réalisé attendu (courbe des coûts)
// ============================================================

/** Mois dont la paie porte des versements hors planning (bonus de mai, 13e mois de décembre, reliquat de janvier). */
const MOIS_PRIMES_ANNUELLES = [1, 5, 12];
const MOIS_SOCLE = 3;

export interface RealiseAttendu {
  /** Coût employeur attendu par mois (index 0 = janvier) ; undefined pour un mois payé ou sans base. */
  valeurs: (number | undefined)[];
  /** Écart moyen réalisé − payé contractuel, variable retiré, des mois qui ont servi à le mesurer. */
  socle: number | null;
  moisSocle: number[];
}

/**
 * Prolonge le réalisé : payé contractuel du mois (qui suit l'effectif projeté)
 * + écart habituel entre réalisé et payé une fois le variable retiré (mesuré
 * sur les derniers mois payés sans bonus ni 13e mois) + variable attendu
 * chargé. Ne modélise ni les bonus, ni le 13e mois des employés.
 */
export function projeterRealise(p: {
  points: { realise?: number; paye?: number }[];
  variable: ProjectionVariable;
  coef: number;
  /** Versements ponctuels attendus hors planning (13e mois des employés…), en brut. */
  ponctuels?: VersementPonctuel[];
}): RealiseAttendu {
  const variableDuMois = new Map(p.variable.mois.map((m) => [m.mois, m]));
  const ecarts: { mois: number; ecart: number }[] = [];
  p.points.forEach((pt, i) => {
    const m = i + 1;
    const v = variableDuMois.get(m);
    if (pt.realise == null || pt.paye == null || !v || v.estime || MOIS_PRIMES_ANNUELLES.includes(m)) return;
    ecarts.push({ mois: m, ecart: pt.realise - pt.paye - v.total * p.coef });
  });
  const retenus = ecarts.slice(-MOIS_SOCLE);
  const socle = retenus.length > 0 ? retenus.reduce((s, e) => s + e.ecart, 0) / retenus.length : null;

  const valeurs = p.points.map((pt, i) => {
    const v = variableDuMois.get(i + 1);
    if (!v?.estime || pt.paye == null || socle === null) return undefined;
    const ponctuel = (p.ponctuels ?? []).filter((x) => x.mois === i + 1).reduce((s, x) => s + x.brut, 0);
    return Math.round(pt.paye + socle + (v.total + ponctuel) * p.coef);
  });
  return { valeurs, socle, moisSocle: retenus.map((e) => e.mois) };
}

// ============================================================
// Décomposition de la paie des mois attendus
// ============================================================

type FamillesMontants = Record<"structurel" | "planning" | "primes" | "regularisations" | "soldes" | "avantages" | "non_verse", number>;

export interface DecompositionAttendue {
  mois: number;
  familles: FamillesMontants;
  /** Brut versé attendu (sans l'avantage en nature non versé). */
  brut: number;
  /** Mois dont la moyenne a servi aux familles hors planning. */
  moisReference: number[];
  /** Le structurel est le reste du réalisé attendu (sinon : moyenne des mois de référence). */
  structurelParDifference: boolean;
  /** Versements ponctuels compris dans le structurel de ce mois (13e mois des employés). */
  ponctuels: VersementPonctuel[];
}

/**
 * Familles de la paie pour chaque mois attendu, cohérentes avec la ligne du
 * réalisé attendu :
 *  - lié au planning = variable attendu (brut) ;
 *  - primes, régularisations, soldes, allocations, avantage non versé =
 *    moyenne des derniers mois payés hors bonus et 13e mois ;
 *  - structurel = réalisé attendu ramené en brut (÷ coefficient) moins les
 *    autres familles versées ; à défaut de réalisé attendu, moyenne.
 */
export function projeterDecomposition(p: {
  parMois: { mois: number; familles: FamillesMontants; brut: number }[];
  variable: ProjectionVariable;
  realiseAttendu: (number | undefined)[];
  coef: number;
  ponctuels?: VersementPonctuel[];
}): DecompositionAttendue[] {
  const reference = p.parMois.filter((m) => !MOIS_PRIMES_ANNUELLES.includes(m.mois)).slice(-MOIS_SOCLE);
  if (reference.length === 0) return [];
  const moyenneFamille = (f: keyof FamillesMontants) => reference.reduce((s, m) => s + m.familles[f], 0) / reference.length;

  return p.variable.mois
    .filter((m) => m.estime)
    .map((m) => {
      const familles: FamillesMontants = {
        structurel: moyenneFamille("structurel"),
        planning: m.total,
        primes: moyenneFamille("primes"),
        regularisations: moyenneFamille("regularisations"),
        soldes: moyenneFamille("soldes"),
        avantages: moyenneFamille("avantages"),
        non_verse: moyenneFamille("non_verse"),
      };
      const realise = p.realiseAttendu[m.mois - 1];
      const parDifference = realise != null && p.coef > 0;
      const ponctuels = (p.ponctuels ?? []).filter((x) => x.mois === m.mois);
      // Sans réalisé attendu, le ponctuel s'ajoute à la moyenne ; avec, il y est déjà
      if (!parDifference) familles.structurel += ponctuels.reduce((s, x) => s + x.brut, 0);
      if (parDifference) {
        const autres = familles.planning + familles.primes + familles.regularisations + familles.soldes + familles.avantages;
        familles.structurel = realise / p.coef - autres;
      }
      const brut = familles.structurel + familles.planning + familles.primes + familles.regularisations + familles.soldes + familles.avantages;
      return { mois: m.mois, familles, brut, moisReference: reference.map((r) => r.mois), structurelParDifference: parDifference, ponctuels };
    });
}

// ============================================================
// 13e mois des employés (versé en décembre)
// ============================================================

export interface VersementPonctuel {
  mois: number;
  libelle: string;
  /** Montant brut. */
  brut: number;
  n: number;
  /** Détail (par fonction), trié par montant décroissant. */
  detail: { libelle: string; n: number; brut: number }[];
  hypothese: string;
}

/** Fonctions sans 13e mois (arbitrage utilisateur du 29/09/2026), comparées sans accents au début de l'intitulé. */
const FONCTIONS_SANS_TREIZIEME = /^(etudiant|accomp|chef de service|key account)/i;
/** Détail par fonction sans groupe identifiable : moins de 3 personnes ⇒ « Autres fonctions » (wp-anonymisation.ts). */
function detailAnonymise(groupes: { libelle: string; n: number; brut: number }[]): { libelle: string; n: number; brut: number }[] {
  const regroupes = regrouperPetitsGroupes(groupes, (g) => g.n, (petits) => ({
    libelle: "Autres fonctions",
    n: petits.reduce((s, g) => s + g.n, 0),
    brut: petits.reduce((s, g) => s + g.brut, 0),
  }));
  const autres = regroupes.filter((g) => g.libelle === "Autres fonctions" && !groupes.includes(g));
  return [...regroupes.filter((g) => !autres.includes(g)).sort((a, b) => b.brut - a.brut), ...autres];
}

const ALLOWANCE_AUTRES_CS_MIN = 100;
const ALLOWANCE_AUTRES_CS_MOIS = 3;

export interface LignePaieTreizieme extends LignePaieVariable {
  type_remuneration?: string | null;
  fonction?: string | null;
  brut_base?: unknown;
}

/**
 * 13e mois des employés, versé en décembre : un mois de brut de base du
 * dernier mois payé (déjà proratisé par le temps de travail), pour tous les
 * salariés SAUF
 *  - les chauffeurs, qui touchent le leur chaque mois (fonction « CHAUFFEUR… »
 *    ou complément CCT versé dans l'année) ;
 *  - les cadres, reconnus à leur avantage en nature voiture (N002) ou à leur
 *    car allowance dans l'année : code ALL, ou montant FIXE et récurrent en
 *    « Autres CS » (même montant ≥ 100 € sur au moins 3 mois : une allowance
 *    saisie sans code, cas d'un directeur en 2026) ;
 *  - les fonctions sans 13e mois : étudiants, accompagnateurs, chefs de
 *    service et key accounts (cadres sans avantage visible dans la paie).
 * Règle de l'utilisateur (29/09/2026). Null sans paie de l'année.
 */
export function treiziemeMoisEmployes(lignes: LignePaieTreizieme[], annee: number): VersementPonctuel | null {
  const deLAnnee = lignes.filter((l) => Number(l.annee) === annee);
  const salaire = deLAnnee.filter((l) => l.type_remuneration !== "non_periodique");
  if (salaire.length === 0) return null;
  const exclus = new Set<string>();
  // Allowance saisie en « Autres CS » : même montant, récurrent
  const autresCs = new Map<string, Map<number, number>>();
  for (const l of salaire) {
    const v = Math.round(nombre(l.nat_autres_cs));
    if (Math.abs(v) < ALLOWANCE_AUTRES_CS_MIN) continue;
    const parMontant = autresCs.get(l.code_salarie) ?? new Map<number, number>();
    parMontant.set(v, (parMontant.get(v) ?? 0) + 1);
    autresCs.set(l.code_salarie, parMontant);
  }
  autresCs.forEach((parMontant, code) => {
    if ([...parMontant.values()].some((n) => n >= ALLOWANCE_AUTRES_CS_MOIS)) exclus.add(code);
  });
  for (const l of deLAnnee) {
    const chauffeur = /^chauffeur/i.test(String(l.fonction ?? "").trim()) || nombre(l.nat_cct) !== 0;
    const cadre = nombre(l.nat_n002) !== 0 || nombre(l.nat_all) !== 0;
    const sansTreizieme = FONCTIONS_SANS_TREIZIEME.test(String(l.fonction ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim());
    if (chauffeur || cadre || sansTreizieme) exclus.add(l.code_salarie);
  }
  const dernier = Math.max(...salaire.map((l) => Number(l.mois)));
  const parFonction = new Map<string, { n: number; brut: number }>();
  let brut = 0, n = 0;
  for (const l of salaire) {
    if (Number(l.mois) !== dernier || exclus.has(l.code_salarie)) continue;
    const base = nombre(l.brut_base);
    if (base <= 0) continue;
    brut += base; n++;
    const f = String(l.fonction || "(sans fonction)");
    const g = parFonction.get(f) ?? { n: 0, brut: 0 };
    parFonction.set(f, { n: g.n + 1, brut: g.brut + base });
  }
  return {
    mois: 12,
    libelle: "13e mois des employés",
    brut,
    n,
    detail: detailAnonymise([...parFonction.entries()].map(([libelle, g]) => ({ libelle, ...g }))),
    hypothese: `Un mois de brut de base (${NOMS_MOIS[dernier]}, dernier mois payé) pour ${n} salariés : ni chauffeurs (fonction chauffeur ou complément mensuel CCT), ni cadres (avantage voiture ou car allowance, y compris saisie en « Autres CS »), ni étudiants, accompagnateurs, chefs de service ou key accounts. Un départ d'ici décembre n'est pas retiré.`,
  };
}
