/**
 * Outils Workforce Planning de l'analyste IA : effectifs, mouvements, congés.
 * Mêmes calculs que les pages Workforce — photos par mois (`preparerPhotosAnnee`),
 * courbe d'effectifs (`construireCourbeEffectifs`), paliers du mois
 * (`calculerPaliers`) — pour que l'IA cite les chiffres des écrans.
 *
 * Mêmes règles d'anonymat que `outils.ts` : groupes de moins de 3 fusionnés,
 * taux par dépôt seulement à partir de 10 ETP, jamais de code salarié.
 *
 * Les photos de `DonneesAnalyse` sont COPIÉES avant toute reclassification :
 * elle modifie les lignes, que les autres outils lisent aussi.
 */

import { rangPeriode } from "@/lib/utils/roster-period";
import { ajouterPhotoSiAbsente, indexerPhotos, photoPourLeMois } from "@/lib/utils/roster-photos";
import { SEUIL_ANONYMAT, regrouperPetitsGroupes } from "@/lib/utils/wp-anonymisation";
import { estChauffeur } from "@/lib/utils/wp-amplitudes";
import { horsWeekEnd, lastDayOfMonth } from "@/lib/utils/wp-calculations";
import { congesHorsWeekEnd, moisCongesComplets } from "@/lib/utils/wp-conges";
import { construireCourbeEffectifs, type MoisAnnee } from "@/lib/utils/wp-courbe-effectifs";
import { estActifLe } from "@/lib/utils/wp-effectif-moyen";
import { computeRosterMovements, reclassifierSortiesTemporaires, sortiesConstateesSur, type MovementItem } from "@/lib/utils/wp-movements";
import { calculerPaliers, etpDe, injustifieesDuPerimetre, type PaliersMois } from "@/lib/utils/wp-paliers";
import { codesAvecMaladieCns, preparerPhotosAnnee } from "@/lib/utils/wp-photos-annee";
import { estFinDeMission, isCongeStructurel } from "@/lib/utils/wp-suspension";
import { SEUIL_CLASSEMENT_DEPOT_ETP } from "@/lib/utils/wp-turnover";
import type { DonneesAnalyse, LignePhotoAnalyse } from "./donnees";
import type { DonneesEffectifs } from "./donnees-workforce";

export type Perimetre = "all" | "drivers";

/** Ligne de photo normalisée pour les calculs Workforce (types numériques et booléens stricts). */
export interface PhotoWf {
  code_salarie: string;
  mois: number;
  annee: number;
  date_entree: string | null;
  date_sortie: string | null;
  est_sortie_temporaire: boolean;
  date_debut_sortie_temporaire: string | null;
  date_fin_sortie_temporaire: string | null;
  description_motif_sortie: string | null;
  taux_occupation: number | null;
  type_contrat: string | null;
  description_service: string | null;
  description_fonction: string | null;
  centre_cout: string | null;
  vehicle_type: string | null;
  /** Brut indice (salaire individuel) : seulement pour les outils Coûts, jamais rendu tel quel. */
  brut_indice?: number | null;
}

function normaliser(x: LignePhotoAnalyse, brut?: number | null): PhotoWf {
  return {
    code_salarie: x.code_salarie,
    mois: Number(x.mois),
    annee: Number(x.annee),
    date_entree: x.date_entree ?? null,
    date_sortie: x.date_sortie ?? null,
    est_sortie_temporaire: !!x.est_sortie_temporaire,
    date_debut_sortie_temporaire: x.date_debut_sortie_temporaire ?? null,
    date_fin_sortie_temporaire: x.date_fin_sortie_temporaire ?? null,
    description_motif_sortie: x.description_motif_sortie ?? null,
    taux_occupation: x.taux_occupation == null ? null : Number(x.taux_occupation),
    type_contrat: x.type_contrat ?? null,
    description_service: x.description_service ?? null,
    description_fonction: x.description_fonction ?? null,
    centre_cout: x.centre_cout ?? null,
    vehicle_type: x.vehicle_type ?? null,
    ...(brut !== undefined ? { brut_indice: brut } : {}),
  };
}

/** Bruts indices par rang de photo puis code salarié (voir DonneesCouts.bruts). */
export type BrutsParPhoto = Map<number, Map<string, number | null>>;

/** Copie normalisée d'une photo, avec son brut indice quand les bruts sont fournis. */
export function copierPhoto(lignes: LignePhotoAnalyse[], rang: number | null, bruts?: BrutsParPhoto): PhotoWf[] {
  const b = bruts && rang != null ? bruts.get(rang) : undefined;
  return lignes.map((x) => normaliser(x, bruts ? (b?.get(x.code_salarie) ?? null) : undefined));
}

const MOIS_EN = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const r1 = (x: number) => Math.round(x * 10) / 10;
const r1n = (x: number | null | undefined) => (x == null ? null : r1(x));
const libelleMois = (mois: number, annee: number) => `${MOIS_EN[mois]} ${annee}`;
const nomDepot = (d: string) => d.replace(/^Depots? - /i, "") || "Not in roster";
const DEFINITION_PERIMETRE: Record<Perimetre, string> = {
  all: "All employees (the Workforce screens without filter).",
  drivers: "Drivers only (function starting with 'Chauffeur').",
};

// ---------------------------------------------------------------- contexte d'une année

/** Mois « affiché » par défaut d'une année, comme les pages : le mois courant, ou décembre pour une année passée. */
export function moisDeReference(annee: number, maintenant: Date) {
  return annee < maintenant.getFullYear() ? 12 : maintenant.getMonth() + 1;
}

/**
 * Tout ce que les pages Workforce préparent pour une année : photos par mois
 * filtrées et reclassifiées, absences de l'année (et de la précédente pour
 * une année future), congés. Reproduit tableau de bord et Coûts à l'identique.
 */
export function contexteAnnee(d: DonneesAnalyse, e: DonneesEffectifs, annee: number, perimetre: Perimetre, maintenant: Date, bruts?: BrutsParPhoto) {
  const moisAffiche = moisDeReference(annee, maintenant);
  const anneeFuture = annee > maintenant.getFullYear();
  const passe = perimetre === "drivers" ? (x: PhotoWf) => estChauffeur(x.description_fonction) : () => true;
  const filtresActifs = perimetre === "drivers";
  // Photos de l'année seulement, plus la photo du mois affiché si elle vient d'une autre année (repli)
  const lignesAnnee = [...d.photos].filter(([r]) => Math.floor((r - 1) / 12) === annee).flatMap(([r, l]) => copierPhoto(l, r, bruts));
  const photosParRang = indexerPhotos(lignesAnnee);
  const affichee = photoPourLeMois(d.photos, moisAffiche, annee);
  const employes = copierPhoto(affichee.lignes, affichee.periode ? rangPeriode(affichee.periode) : null, bruts);
  ajouterPhotoSiAbsente(photosParRang, affichee.periode, employes);

  const deLAnnee = <T extends { annee: number }>(l: T[], a = annee) => l.filter((x) => x.annee === a);
  const cns = deLAnnee(e.cns);
  const cnsPrec = anneeFuture ? deLAnnee(e.cns, annee - 1) : [];
  const codesMaladie = codesAvecMaladieCns(cns, cnsPrec);
  const photoAffichee = reclassifierSortiesTemporaires(employes.filter(passe), codesMaladie);
  const mouvementsSirh = d.mouvements.filter((m) => m.type === "sortie" || m.type === "sortie_temporaire");
  const sortiesStats = e.sortiesStats.filter((s) => s.annee === annee);
  const photos = preparerPhotosAnnee({
    annee,
    photosParRang,
    photoAffichee,
    passe,
    codesMaladie,
    sortiesConstateesSur: (mois, a, prec) => sortiesConstateesSur(mouvementsSirh, sortiesStats, mois, a, prec),
  });

  const mctHorsWeekEnd = horsWeekEnd(deLAnnee(e.mct));
  const injustifiees = deLAnnee(e.injustifiees);
  const conges = congesHorsWeekEnd(deLAnnee(e.conges));
  const complets = moisCongesComplets(e.importsMct, annee);

  const courbe = construireCourbeEffectifs({
    selectedYear: annee,
    selectedMonth: moisAffiche,
    now: maintenant,
    anneeFuture,
    filtresActifs,
    targetTotal: 0,
    photoDuMoisDe: photos.photoDuMoisDe,
    photoExacte: photos.photoExacte,
    sortisHorsPhotoPour: photos.sortisHorsPhotoPour,
    absences: cns,
    mctHorsWeekEnd,
    absencesInjustifiees: injustifiees,
    absencesAnneePrec: cnsPrec,
    mctAnneePrec: anneeFuture ? deLAnnee(e.mct, annee - 1) : [],
    injAnneePrec: anneeFuture ? deLAnnee(e.injustifiees, annee - 1) : [],
    congesHorsWeekEnd: conges,
    moisCongesComplets: complets,
  });

  /** Paliers de fin de mois d'une population (un dépôt, un regroupement) : mêmes règles que les KPI du tableau de bord. */
  const paliersDe = (population: PhotoWf[], mois: number, perimetrePartiel: boolean): PaliersMois => {
    const codes = new Set(population.map((x) => x.code_salarie));
    const restreindre = <T extends { code_salarie: string }>(l: T[]) => l.filter((x) => codes.has(x.code_salarie));
    return calculerPaliers(
      population,
      restreindre(cns),
      restreindre(mctHorsWeekEnd),
      injustifieesDuPerimetre(injustifiees, perimetrePartiel || filtresActifs, codes),
      mois,
      annee,
      restreindre(conges)
    );
  };

  return { annee, moisAffiche, anneeFuture, perimetre, filtresActifs, photoAffichee, photos, courbe, paliersDe, mouvementsSirh, sortiesStats, cns, mctHorsWeekEnd, injustifiees, conges };
}

// ---------------------------------------------------------------- outils

function anneeConnue(d: DonneesAnalyse, annee: number) {
  const annees = [...new Set([...d.photos.keys()].map((r) => Math.floor((r - 1) / 12)))].sort();
  return annees.includes(annee) || annees.some((a) => a < annee) ? null : { error: `No roster snapshot for ${annee} or earlier. Roster years: ${annees.join(", ") || "none"}.` };
}

export async function courbeEffectifs(d: DonneesAnalyse, p: { year: number; scope?: Perimetre }, maintenant = new Date()) {
  const inconnue = anneeConnue(d, p.year);
  if (inconnue) return inconnue;
  const perimetre = p.scope ?? "all";
  const c = contexteAnnee(d, await d.effectifs(), p.year, perimetre, maintenant);
  return {
    year: p.year,
    scope: DEFINITION_PERIMETRE[perimetre],
    definition:
      "Month-end FTE chain, as on the Workforce dashboard: under contract → after contract suspensions (parental, maternity, unpaid leave…) → after CNS sick leave = 'actual' → after unjustified absences = 'paid' → after short sick leave MCT = 'available' → after holidays and special leave. Absence rates are those applied in the month (measured, or carried over from the last known month when 'estimated').",
    by_month: c.courbe.headcountData.map((pt, i) => {
      const mois = i + 1;
      const disponible = pt.effectif_apres_mct ?? pt.projected_apres_mct;
      const apresConges = pt.effectif_apres_conges ?? pt.projected_apres_conges;
      return {
        month: libelleMois(mois, p.year),
        status: pt.is_projection ? "projected" : pt.reporte?.brut ? "carried over from an earlier roster" : "actual",
        under_contract_fte: pt.effectif_brut,
        after_suspensions_fte: pt.effectif_net,
        after_cns_sick_leave_fte: r1n(pt.effectif_reel),
        paid_fte: r1n(pt.effectif_apres_injustifiees ?? pt.projected_apres_injustifiees),
        available_fte: r1n(disponible),
        available_after_leave_fte: r1n(apresConges),
        absences_estimated: pt.effectif_apres_mct === undefined && pt.projected_apres_mct !== undefined,
        leave_complete: pt.conges_complet ?? null,
        monthly_average: pt.moyenne ? { under_contract_fte: r1n(pt.moyenne.effectif_brut), after_suspensions_fte: r1n(pt.moyenne.effectif_net), paid_fte: r1n(pt.moyenne.effectif_apres_injustifiees) } : null,
        rates_applied_pct: pt.taux_appliques
          ? { cns_sick_leave: r1n(pt.taux_appliques.cns), unjustified: r1n(pt.taux_appliques.inj), short_sick_mct: r1n(pt.taux_appliques.mct), holidays: r1n(pt.taux_appliques.conges), special_leave: r1n(pt.taux_appliques.extra) }
          : null,
      };
    }),
    notes: [
      "Months after the current month are projected from the latest roster (known exits and returns) and the last known absence rates, without scenario assumptions (see scenario_projection).",
      "available_after_leave_fte is null when no holiday data exists for the month; leave_complete false means drivers' holidays were not imported for that month.",
    ],
  };
}

interface GroupeDepot {
  depots: string[];
  population: PhotoWf[];
}

export async function effectifsParDepot(d: DonneesAnalyse, p: { year: number; month: number; scope?: Perimetre }, maintenant = new Date()) {
  const inconnue = anneeConnue(d, p.year);
  if (inconnue) return inconnue;
  const perimetre = p.scope ?? "all";
  const c = contexteAnnee(d, await d.effectifs(), p.year, perimetre, maintenant);
  const refDate = lastDayOfMonth(p.year, p.month);
  const photo = c.photos.photoDuMois(p.month).filter((x) => estActifLe(x, refDate));
  const parDepot = new Map<string, PhotoWf[]>();
  photo.forEach((x) => {
    const k = x.description_service || "";
    parDepot.set(k, [...(parDepot.get(k) ?? []), x]);
  });
  const groupes = regrouperPetitsGroupes<GroupeDepot>(
    [...parDepot].map(([depot, population]) => ({ depots: [depot], population })),
    (g) => g.population.length,
    (petits) => ({ depots: petits.flatMap((g) => g.depots), population: petits.flatMap((g) => g.population) })
  );
  const lire = (pa: PaliersMois) => ({
    headcount: pa.headcount,
    under_contract_fte: r1(pa.sousContrat),
    suspended_fte: r1(pa.etpSuspendu),
    after_suspensions_fte: r1(pa.apresSuspension),
    paid_fte: r1(pa.apresInjustifiees),
    available_fte: r1(pa.apresMct),
    available_after_leave_fte: pa.congesMesure ? r1(pa.apresConges) : null,
  });
  const taux = (pa: PaliersMois) => ({
    cns_sick_leave_pct: pa.cnsMesure ? r1(pa.tauxCns) : null,
    unjustified_pct: pa.injustifieesMesure ? r1(pa.tauxInjustifiees) : null,
    short_sick_mct_pct: pa.mctMesure ? r1(pa.tauxMct) : null,
    holidays_pct: pa.congesMesure ? r1(pa.tauxConges) : null,
    total_absence_pct: pa.cnsMesure || pa.mctMesure ? r1(pa.tauxGlobal) : null,
  });
  // Total : le point de la courbe, celui des écrans (taux manquants repris du dernier mois connu)
  const pt = c.courbe.headcountData[p.month - 1];
  const global = c.paliersDe(photo, p.month, false);
  const photoExacte = c.photos.photoExacte(p.month, p.year);
  const manquants = [
    !global.cnsMesure && "CNS sick leave",
    !global.injustifieesMesure && "unjustified absences",
    !global.mctMesure && "short sick leave (MCT)",
    !global.congesMesure && "holidays",
  ].filter(Boolean);
  return {
    year: p.year,
    month: libelleMois(p.month, p.year),
    scope: DEFINITION_PERIMETRE[perimetre],
    roster: photoExacte ? "roster snapshot of the month" : "no roster for this month: latest earlier roster carried over",
    definition: "Month-end FTE per depot (depot = 'service' in the HR roster): under contract, suspended, after suspensions, paid (after CNS sick leave and unjustified absences), available (after short sick leave MCT), after holidays. Rates in % of FTE after suspensions.",
    overall: {
      headcount: global.headcount,
      under_contract_fte: pt.effectif_brut,
      suspended_fte: r1(global.etpSuspendu),
      after_suspensions_fte: pt.effectif_net,
      paid_fte: r1n(pt.effectif_apres_injustifiees ?? pt.projected_apres_injustifiees),
      available_fte: r1n(pt.effectif_apres_mct ?? pt.projected_apres_mct),
      available_after_leave_fte: r1n(pt.effectif_apres_conges ?? pt.projected_apres_conges),
      rates_applied_pct: pt.taux_appliques
        ? { cns_sick_leave: r1n(pt.taux_appliques.cns), unjustified: r1n(pt.taux_appliques.inj), short_sick_mct: r1n(pt.taux_appliques.mct), holidays: global.congesMesure ? r1(global.tauxConges) : null }
        : null,
    },
    missing_data_this_month: manquants.length
      ? `No ${manquants.join(", ")} data for this month: the company total carries over the last known rate (as the dashboard does); depot figures do not deduct it.`
      : null,
    by_depot: groupes
      .map((g) => {
        const pa = c.paliersDe(g.population, p.month, true);
        const fusion = g.depots.length > 1;
        const classable = pa.apresSuspension >= SEUIL_CLASSEMENT_DEPOT_ETP;
        return {
          depot: fusion ? `Others (${g.depots.length} depots)` : nomDepot(g.depots[0]),
          ...lire(pa),
          ...(classable ? taux(pa) : { rates: "not shown (under 10 FTE)" }),
          bus_fte: r1(g.population.filter((x) => x.vehicle_type === "BUS").reduce((s, x) => s + etpDe(x), 0)),
          van_fte: r1(g.population.filter((x) => x.vehicle_type === "CAM").reduce((s, x) => s + etpDe(x), 0)),
        };
      })
      .sort((a, b) => b.under_contract_fte - a.under_contract_fte),
    excluded: `Depots with fewer than ${SEUIL_ANONYMAT} people are merged into 'Others'; absence rates are not shown under ${SEUIL_CLASSEMENT_DEPOT_ETP} FTE.`,
  };
}

/** Catégorie d'une suspension en cours, sans détail qui isolerait une personne. */
function categorieSuspension(motif: string | null | undefined) {
  const m = (motif ?? "").toLowerCase();
  if (m.includes("parental")) return "Parental leave";
  if (m.includes("maternit")) return "Maternity leave";
  if (m.includes("sans solde")) return "Unpaid leave";
  if (isCongeStructurel(motif ?? "")) return "Other structural leave";
  return "Other suspension (incl. long sickness)";
}

function compterParCategorie(items: { categorie: string; etp: number }[]) {
  const parCat = new Map<string, { people: number; fte: number }>();
  items.forEach((i) => {
    const v = parCat.get(i.categorie) ?? { people: 0, fte: 0 };
    v.people += 1;
    v.fte += i.etp;
    parCat.set(i.categorie, v);
  });
  return regrouperPetitsGroupes(
    [...parCat].map(([category, v]) => ({ category, ...v })),
    (g) => g.people,
    (petits) => ({ category: "Other categories", people: petits.reduce((s, g) => s + g.people, 0), fte: petits.reduce((s, g) => s + g.fte, 0) })
  ).map((g) => ({ ...g, fte: r1(g.fte) }));
}

export async function mouvementsEffectifs(d: DonneesAnalyse, p: { year: number; scope?: Perimetre }, maintenant = new Date()) {
  const inconnue = anneeConnue(d, p.year);
  if (inconnue) return inconnue;
  const perimetre = p.scope ?? "all";
  const c = contexteAnnee(d, await d.effectifs(), p.year, perimetre, maintenant);
  const somme = (l: MovementItem[]) => r1(l.reduce((s, i) => s + i.etp, 0));
  const parMois = Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
    const prec: MoisAnnee = m === 1 ? { mois: 12, annee: p.year - 1 } : { mois: m - 1, annee: p.year };
    if (!c.photos.photoExacte(m, p.year) || !c.photos.photoExacte(prec.mois, prec.annee)) {
      return { month: libelleMois(m, p.year), compared: false as const };
    }
    const mv = computeRosterMovements(
      c.photos.photoDuMoisDe(prec.mois, prec.annee), c.photos.photoDuMois(m), m, p.year,
      sortiesConstateesSur(c.mouvementsSirh, c.sortiesStats, m, p.year, prec)
    );
    const sorties = [...mv.sortiesDefinitives, ...mv.disparusSansDate];
    const finsDeMission = sorties.filter((i) => estFinDeMission(i.motif));
    const autres = sorties.filter((i) => !estFinDeMission(i.motif));
    return {
      month: libelleMois(m, p.year),
      compared: true as const,
      entries: { people: mv.nouveaux.length, fte: somme(mv.nouveaux) },
      exits_excluding_end_of_assignment: { people: autres.length, fte: somme(autres) },
      ends_of_assignment: { people: finsDeMission.length, fte: somme(finsDeMission) },
      new_suspensions: { people: mv.sortiesTemporaires.length, fte: somme(mv.sortiesTemporaires) },
      returns_from_suspension: { people: mv.retours.length, fte: somme(mv.retours) },
    };
  });

  // Situation au dernier mois réel : suspensions en cours, départs et retours connus à venir
  const dernierMois = Math.min(c.moisAffiche, 12);
  const refDate = lastDayOfMonth(p.year, dernierMois);
  const photo = c.photos.photoDuMois(dernierMois);
  const actifs = photo.filter((x) => estActifLe(x, refDate));
  const suspendus = actifs.filter((x) => x.est_sortie_temporaire && x.date_debut_sortie_temporaire && x.date_debut_sortie_temporaire <= refDate);
  const aVenir = (date: (x: PhotoWf) => string | null | undefined, population: PhotoWf[]) => {
    const parMoisAVenir = new Map<number, number>();
    population.forEach((x) => {
      const dt = date(x);
      if (!dt || dt <= refDate) return;
      const r = Number(dt.slice(0, 4)) * 12 + Number(dt.slice(5, 7));
      if (r > rangPeriode({ mois: dernierMois, annee: p.year }) + 12) return;
      parMoisAVenir.set(r, (parMoisAVenir.get(r) ?? 0) + 1);
    });
    const lignes = [...parMoisAVenir].sort(([a], [b]) => a - b).map(([r, n]) => ({ month: libelleMois(((r - 1) % 12) + 1, Math.floor((r - 1) / 12)), people: n }));
    // Un mois à 1 ou 2 personnes se lit comme une liste nominative : seuls les totaux sont rendus alors
    return lignes.every((l) => l.people >= SEUIL_ANONYMAT) ? lignes : { total_people: lignes.reduce((s, l) => s + l.people, 0), months_with_events: lignes.length };
  };
  return {
    year: p.year,
    scope: DEFINITION_PERIMETRE[perimetre],
    definition: "Movements between two consecutive monthly roster snapshots (only when both months have their own snapshot): entries, exits (actual exit dates from the HR IN/OUT export or payroll), ends of temporary assignments, new contract suspensions and returns, in people and FTE.",
    by_month: parMois,
    situation_at: libelleMois(dernierMois, p.year),
    suspensions_in_progress: { people: suspendus.length, fte: r1(suspendus.reduce((s, x) => s + etpDe(x), 0)), by_category: compterParCategorie(suspendus.map((x) => ({ categorie: categorieSuspension(x.description_motif_sortie), etp: etpDe(x) }))) },
    upcoming_12_months: {
      known_exits: aVenir((x) => x.date_sortie, actifs),
      known_returns_from_suspension: aVenir((x) => x.date_fin_sortie_temporaire, suspendus),
      known_hires_already_in_roster: aVenir((x) => x.date_entree, photo),
    },
    notes: [
      "Upcoming events are only those already recorded in the HR roster (planned exit dates, planned return dates, signed future hires); scenario assumptions are not included.",
      `Monthly counts under ${SEUIL_ANONYMAT} people are not detailed (totals only), to avoid identifying individuals.`,
    ],
  };
}
