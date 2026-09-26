/**
 * Analyse du turnover : volontaire / involontaire, par mois, par motif et par
 * dépôt. Tout en ETP, rapporté à l'effectif MOYEN (moyenne des fins de mois
 * couverts), comme le KPI du tableau de bord.
 *
 * Classification des motifs (arbitrage utilisateur 2026-09-15) :
 * - volontaire : démission, résiliation de commun accord, transfert société,
 *   préretraite, pension de vieillesse (retraite) ;
 * - involontaire : licenciement, période d'essai non concluante,
 *   reclassement externe, décès ;
 * - fin de mission (terme d'un CDD) : hors turnover, comptée à part ;
 * - autre : motif inconnu, affiché pour ne rien perdre en silence.
 */

import { actifsEnFinDeMois, lastDayOfMonth, moisEffetSortie, type SalariePhoto } from "./wp-calculations";
import { photoPourLeMois, type PhotosParRang } from "./roster-photos";
import { estFinDeMission } from "./wp-suspension";

export type CategorieSortie = "volontaire" | "involontaire" | "fin_de_mission" | "autre";

export const CATEGORIE_LABELS: Record<CategorieSortie, string> = {
  volontaire: "Volontaire",
  involontaire: "Involontaire",
  fin_de_mission: "Fin de mission (CDD)",
  autre: "Autre",
};

/** Dépôts trop petits pour être classés « plus fort / plus faible » (une sortie = 10 %). */
export const SEUIL_CLASSEMENT_DEPOT_ETP = 10;

export const DEPOT_NON_RENSEIGNE = "Non renseigné";

function normaliser(texte: string): string {
  return texte.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function classerMotifSortie(motif: string | null | undefined): CategorieSortie {
  if (estFinDeMission(motif)) return "fin_de_mission";
  const m = normaliser(motif || "");
  if (!m) return "autre";
  if (/demission|commun accord|transfert|preretraite|pension|retraite/.test(m)) return "volontaire";
  if (/licenciement|essai|reclassement|deces/.test(m)) return "involontaire";
  return "autre";
}

export interface LignePhotoTurnover extends SalariePhoto {
  mois: number | string;
  annee: number | string;
  taux_occupation?: number | string | null;
  description_service?: string | null;
  type_contrat?: string | null;
}

export interface MouvementSortie {
  code_salarie: string;
  type: string;
  motif_sortie?: string | null;
  date_sortie?: string | null;
  mois: number | string;
  annee: number | string;
}

export interface SortieAnalysee {
  code_salarie: string;
  motif: string;
  categorie: CategorieSortie;
  /** Mois d'EFFET (dernier jour du mois ⇒ mois suivant) */
  mois: number;
  etp: number;
  depot: string;
}

const etpDe = (e: { taux_occupation?: number | string | null }) => Number(e.taux_occupation || 100) / 100;
const depotDe = (e: { description_service?: string | null }) => e.description_service || DEPOT_NON_RENSEIGNE;

/** Dernière fiche connue de chaque salarié, toutes photos confondues (la plus récente gagne). */
function dernieresFiches<T extends LignePhotoTurnover>(photos: PhotosParRang<T>): Map<string, T> {
  const fiches = new Map<string, T>();
  [...photos.keys()].sort((a, b) => a - b).forEach((r) => {
    (photos.get(r) ?? []).forEach((e) => fiches.set(e.code_salarie, e));
  });
  return fiches;
}

/**
 * Sorties définitives d'une année, dédoublonnées par salarié.
 * Source 1 : l'export IN/OUT s'il couvre l'année (dates et motifs réels).
 * Source 2 : les dates de sortie lues photo par photo (sorties PRÉVUES
 * seulement : une photo ne contient plus les partis avant son export).
 */
export function sortiesDeLAnnee<T extends LignePhotoTurnover>(
  annee: number,
  photos: PhotosParRang<T>,
  mouvements: MouvementSortie[]
): SortieAnalysee[] {
  const fiches = dernieresFiches(photos);
  const parCode = new Map<string, SortieAnalysee>();

  const sirhCouvre = mouvements.some((mv) => Number(mv.annee) === annee);
  if (sirhCouvre) {
    mouvements
      .filter((mv) => mv.type === "sortie")
      .forEach((mv) => {
        const effet = mv.date_sortie
          ? moisEffetSortie(String(mv.date_sortie).slice(0, 10))
          : { mois: Number(mv.mois), annee: Number(mv.annee) };
        if (effet.annee !== annee) return;
        const fiche = fiches.get(mv.code_salarie);
        const motif = mv.motif_sortie || fiche?.description_motif_sortie || "";
        parCode.set(mv.code_salarie, {
          code_salarie: mv.code_salarie,
          motif: motif || "Non spécifié",
          categorie: classerMotifSortie(motif),
          mois: effet.mois,
          etp: fiche ? etpDe(fiche) : 1,
          depot: fiche ? depotDe(fiche) : DEPOT_NON_RENSEIGNE,
        });
      });
    return [...parCode.values()];
  }

  for (let m = 1; m <= 12; m++) {
    photoPourLeMois(photos, m, annee).lignes.forEach((e) => {
      if (!e.date_sortie || e.est_sortie_temporaire || parCode.has(e.code_salarie)) return;
      const effet = moisEffetSortie(e.date_sortie);
      if (effet.mois !== m || effet.annee !== annee) return;
      const motif = e.description_motif_sortie || "";
      parCode.set(e.code_salarie, {
        code_salarie: e.code_salarie,
        motif: motif || "Non spécifié",
        categorie: classerMotifSortie(motif),
        mois: m,
        etp: etpDe(e),
        depot: depotDe(e),
      });
    });
  }
  return [...parCode.values()];
}

export interface CompteCategorie {
  nb: number;
  etp: number;
  /** % de l'effectif moyen */
  taux: number;
}

export interface TurnoverDepot {
  depot: string;
  effectifMoyenEtp: number;
  sortiesEtp: number;
  volontaireEtp: number;
  involontaireEtp: number;
  /** sorties hors fin de mission / effectif moyen, en % */
  taux: number;
  tauxVolontaire: number;
  tauxInvolontaire: number;
  /** Effectif suffisant pour figurer au classement */
  classable: boolean;
}

export interface TurnoverAnnee {
  annee: number;
  moisCouverts: number[];
  effectifMoyenEtp: number;
  categories: Record<CategorieSortie, CompteCategorie>;
  /** Hors fin de mission, en % de l'effectif moyen */
  tauxTotal: number;
  parMois: {
    mois: number;
    volontaire: number;
    involontaire: number;
    autre: number;
    /** Effectif (ETP) en fin de mois, lu dans la photo du mois — la même base que l'effectif moyen de l'année. */
    effectifEtp: number;
    /** Sorties du mois hors fins de mission / effectif en fin de mois, en %, 2 décimales. */
    taux: number;
    /** false : le mois n'a pas sa photo, l'effectif est reconduit de la plus récente. */
    couvert: boolean;
  }[];
  parMotif: { motif: string; categorie: CategorieSortie; nb: number; etp: number; part: number }[];
  /** Classables d'abord, puis du taux le plus fort au plus faible */
  parDepot: TurnoverDepot[];
}

const arrondi1 = (n: number) => Math.round(n * 10) / 10;
const pct = (num: number, den: number) => (den > 0 ? arrondi1((num / den) * 100) : 0);

export function analyserTurnover<T extends LignePhotoTurnover>(
  annee: number,
  moisCouverts: number[],
  photos: PhotosParRang<T>,
  mouvements: MouvementSortie[]
): TurnoverAnnee {
  const sorties = sortiesDeLAnnee(annee, photos, mouvements);

  // Effectif moyen (ETP) total et par dépôt : moyenne des fins de mois couverts
  const totalParMois: number[] = [];
  const parDepotParMois = new Map<string, number[]>();
  moisCouverts.forEach((m, i) => {
    const actifs = actifsEnFinDeMois(photoPourLeMois(photos, m, annee).lignes, lastDayOfMonth(annee, m));
    totalParMois.push(actifs.reduce((s, e) => s + etpDe(e), 0));
    actifs.forEach((e) => {
      const d = depotDe(e);
      if (!parDepotParMois.has(d)) parDepotParMois.set(d, new Array(moisCouverts.length).fill(0));
      parDepotParMois.get(d)![i] += etpDe(e);
    });
  });
  const moyenne = (v: number[]) => (v.length > 0 ? v.reduce((a, b) => a + b, 0) / v.length : 0);
  const effectifMoyenEtp = moyenne(totalParMois);

  const vide = (): CompteCategorie => ({ nb: 0, etp: 0, taux: 0 });
  const categories: Record<CategorieSortie, CompteCategorie> = {
    volontaire: vide(), involontaire: vide(), fin_de_mission: vide(), autre: vide(),
  };
  sorties.forEach((s) => { categories[s.categorie].nb += 1; categories[s.categorie].etp += s.etp; });
  (Object.keys(categories) as CategorieSortie[]).forEach((c) => {
    categories[c].etp = arrondi1(categories[c].etp);
    categories[c].taux = pct(categories[c].etp, effectifMoyenEtp);
  });
  const etpHorsFinMission = categories.volontaire.etp + categories.involontaire.etp + categories.autre.etp;

  const parMois = Array.from({ length: 12 }, (_, i) => ({
    mois: i + 1, volontaire: 0, involontaire: 0, autre: 0, effectifEtp: 0, taux: 0, couvert: false,
  }));
  sorties.forEach((s) => {
    if (s.categorie === "fin_de_mission") return;
    parMois[s.mois - 1][s.categorie] = arrondi1(parMois[s.mois - 1][s.categorie] + s.etp);
  });
  // Taux mensuel : même base que le taux de l'année (effectif en fin de mois,
  // dans la photo du mois). Un mois sans photo reconduit la plus récente, dont
  // les sorties déjà datées sont retirées par `actifsEnFinDeMois`.
  parMois.forEach((m) => {
    // `moisCouverts` dit qu'un mois est ÉCOULÉ, pas qu'il a son roster :
    // septembre en cours peut n'avoir que la photo d'août. Seule `exacte` le dit.
    const photo = photoPourLeMois(photos, m.mois, annee);
    m.couvert = photo.exacte;
    const actifs = actifsEnFinDeMois(photo.lignes, lastDayOfMonth(annee, m.mois));
    const effectif = actifs.reduce((s, e) => s + etpDe(e), 0);
    m.effectifEtp = arrondi1(effectif);
    const sortis = m.volontaire + m.involontaire + m.autre;
    m.taux = effectif > 0 ? Math.round((sortis / effectif) * 10000) / 100 : 0;
  });

  const motifs = new Map<string, { categorie: CategorieSortie; nb: number; etp: number }>();
  sorties.forEach((s) => {
    const m = motifs.get(s.motif) ?? { categorie: s.categorie, nb: 0, etp: 0 };
    m.nb += 1; m.etp += s.etp; motifs.set(s.motif, m);
  });
  const etpToutesSorties = sorties.reduce((s, x) => s + x.etp, 0);
  const parMotif = [...motifs.entries()]
    .map(([motif, m]) => ({ motif, categorie: m.categorie, nb: m.nb, etp: arrondi1(m.etp), part: pct(m.etp, etpToutesSorties) }))
    .sort((a, b) => b.etp - a.etp);

  const depots = new Set<string>([...parDepotParMois.keys(), ...sorties.map((s) => s.depot)]);
  const parDepot: TurnoverDepot[] = [...depots].map((depot) => {
    const eff = moyenne(parDepotParMois.get(depot) ?? new Array(moisCouverts.length).fill(0));
    const des = sorties.filter((s) => s.depot === depot && s.categorie !== "fin_de_mission");
    const vol = des.filter((s) => s.categorie === "volontaire").reduce((a, s) => a + s.etp, 0);
    const inv = des.filter((s) => s.categorie === "involontaire").reduce((a, s) => a + s.etp, 0);
    const tot = des.reduce((a, s) => a + s.etp, 0);
    return {
      depot,
      effectifMoyenEtp: arrondi1(eff),
      sortiesEtp: arrondi1(tot),
      volontaireEtp: arrondi1(vol),
      involontaireEtp: arrondi1(inv),
      taux: pct(tot, eff),
      tauxVolontaire: pct(vol, eff),
      tauxInvolontaire: pct(inv, eff),
      classable: eff >= SEUIL_CLASSEMENT_DEPOT_ETP,
    };
  }).sort((a, b) =>
    // Classables d'abord : un dépôt de 0,1 ETP avec une sortie afficherait 1 000 % en tête
    Number(b.classable) - Number(a.classable) || b.taux - a.taux || b.effectifMoyenEtp - a.effectifMoyenEtp
  );

  return {
    annee,
    moisCouverts,
    effectifMoyenEtp: arrondi1(effectifMoyenEtp),
    categories,
    tauxTotal: pct(etpHorsFinMission, effectifMoyenEtp),
    parMois,
    parMotif,
    parDepot,
  };
}
