/**
 * Outils Coûts de l'analyste IA : masse salariale, coût par ETP, natures de
 * paie, intérim. Même enchaînement que la page Coûts (paie fusionnée,
 * coefficient de charges, construireCourbeCouts) pour citer les chiffres de
 * l'écran.
 *
 * Salaires = données les plus sensibles : seuls sortent des totaux (arrondis
 * à l'euro) et des moyennes sur 10 personnes ou plus ; dépôts et fonctions de
 * moins de 3 salariés fusionnés ; jamais de minimum, maximum ni médiane.
 */

import { regrouperPetitsGroupes, SEUIL_ANONYMAT } from "@/lib/utils/wp-anonymisation";
import { estChauffeur } from "@/lib/utils/wp-amplitudes";
import { construireCourbeCouts } from "@/lib/utils/wp-courbe-couts";
import {
  calculerCoefficientCharges,
  calculerCoefficientsParCostCenter,
  calculerComplementsRecurrents,
  fusionnerSourcesPaie,
  type LignePaieDetaillee,
  type LigneStatSalariale,
} from "@/lib/utils/wp-couts";
import { agregerInterimParCostCenter } from "@/lib/utils/wp-interim";
import { decomposerParMois, decomposerParNature, FAMILLES, NATURES, ventilerPar, type LignePaieDecomposable, type MontantsParFamille, type VentilationLigne } from "@/lib/utils/wp-natures-paie";
import type { DonneesAnalyse } from "./donnees";
import type { DonneesCouts } from "./donnees-workforce";
import { contexteAnnee, copierPhoto, type Perimetre } from "./outils-workforce";

const MOIS_EN = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const eur = (x: number | null | undefined) => (x == null ? null : Math.round(x));
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const libelleMois = (mois: number, annee: number) => `${MOIS_EN[mois]} ${annee}`;
const nomDepot = (d: string) => d.replace(/^Depots? - /i, "");
/** Moyenne par personne : publiée à partir de 10 personnes seulement (sinon proche d'un salaire individuel). */
const SEUIL_MOYENNE_SALAIRE = 10;
const FAMILLES_EN: Record<string, string> = {
  structurel: "structural (base pay, prorated 13th month, function bonus)",
  planning: "planning-related (overtime, long-day premiums, 6th days, night/Sunday/holiday supplements)",
  primes: "bonuses",
  regularisations: "adjustments",
  soldes: "leaving balances",
  avantages: "allowances",
  non_verse: "benefits in kind (not paid out)",
};
const familles = (f: MontantsParFamille) => Object.fromEntries(FAMILLES.map((x) => [x.id, eur(f[x.id])]));
const perimetreEn = (p: Perimetre) => (p === "drivers" ? "Drivers only (function starting with 'Chauffeur')." : "All employees (the Costs screen without filter).");

/**
 * Ventilation de paie où tout groupe de moins de 10 salariés est fusionné :
 * le total d'un petit groupe divisé par son effectif redonne des salaires
 * individuels. Plus strict que l'écran (3), car un deck circule.
 */
function fusionnerSousSeuil(lignes: VentilationLigne[], libelleAutres: string): VentilationLigne[] {
  return regrouperPetitsGroupes(lignes, (l) => l.salaries, (petits) => {
    const f = petits.reduce((acc, l) => {
      (Object.keys(acc) as (keyof MontantsParFamille)[]).forEach((k) => (acc[k] += l.familles[k]));
      return acc;
    }, { structurel: 0, planning: 0, primes: 0, regularisations: 0, soldes: 0, avantages: 0, non_verse: 0 } as MontantsParFamille);
    const brut = petits.reduce((s, l) => s + l.brut, 0);
    return {
      cle: `${libelleAutres} (${petits.length})`,
      familles: f,
      brut,
      n: petits.reduce((s, l) => s + l.n, 0),
      salaries: petits.reduce((s, l) => s + l.salaries, 0),
      partPlanning: brut > 0 ? (f.planning / brut) * 100 : null,
    };
  }, SEUIL_MOYENNE_SALAIRE).sort((a, b) => b.brut - a.brut);
}

/** Dernier (année, mois) d'une liste qui porte des charges patronales. */
function dernierMoisAvecCharges(l: { mois: unknown; annee: unknown; charges_patronales?: unknown }[]) {
  let best: { mois: number; annee: number } | null = null;
  for (const x of l) {
    if (!(Number(x.charges_patronales) > 0)) continue;
    const c = { mois: Number(x.mois), annee: Number(x.annee) };
    if (!best || c.annee * 12 + c.mois > best.annee * 12 + best.mois) best = c;
  }
  return best;
}

/** Toute la préparation de la page Coûts pour une année. */
export function contexteCouts(d: DonneesAnalyse, eff: Parameters<typeof contexteAnnee>[1], co: DonneesCouts, annee: number, perimetre: Perimetre, maintenant: Date) {
  const c = contexteAnnee(d, eff, annee, perimetre, maintenant, co.bruts);
  const employeeCodes = new Set(c.photoAffichee.map((e) => e.code_salarie));
  const codesPerimetre = c.filtresActifs ? employeeCodes : undefined;

  const deLAnnee = <T extends { annee: unknown }>(l: T[]) => l.filter((x) => Number(x.annee) === annee);
  const duMois = <T extends { annee: unknown; mois: unknown }>(l: T[], m: { mois: number; annee: number } | null) =>
    m && m.annee !== annee ? l.filter((x) => Number(x.annee) === m.annee && Number(x.mois) === m.mois) : [];
  const lignesAnnee = deLAnnee(co.lignes);
  const lignesCoefficient = duMois(co.lignes, dernierMoisAvecCharges(co.lignes));
  const paie = fusionnerSourcesPaie(
    [...deLAnnee(co.stats), ...duMois(co.stats, dernierMoisAvecCharges(co.stats))] as LigneStatSalariale[],
    [...lignesAnnee, ...lignesCoefficient] as LignePaieDetaillee[]
  );
  const coefficient = calculerCoefficientCharges(paie, codesPerimetre);
  const coefParCc = calculerCoefficientsParCostCenter(paie);
  const complements = calculerComplementsRecurrents([...lignesAnnee, ...lignesCoefficient]);

  // Photo de référence salariale : la plus récente qui porte un brut indice (non filtrée)
  const rangReference = [...co.bruts].filter(([, m]) => [...m.values()].some((b) => (b ?? 0) > 0)).map(([r]) => r).sort((a, b) => b - a)[0];
  const photoReference = rangReference != null ? copierPhoto(d.photos.get(rangReference) ?? [], rangReference, co.bruts) : null;

  const courbeCouts = construireCourbeCouts({
    headcountData: c.courbe.headcountData,
    selectedYear: annee,
    filtresActifs: c.filtresActifs,
    photoDuMois: c.photos.photoDuMois,
    photoReference,
    coef: coefficient.coef,
    coefParCc,
    complements,
    absences: c.cns,
    mctHorsWeekEnd: c.mctHorsWeekEnd,
    absencesInjustifiees: c.injustifiees,
    congesHorsWeekEnd: c.conges,
    stats: paie,
  });
  return { c, codesPerimetre, lignesAnnee: lignesAnnee as unknown as LignePaieDecomposable[], coefficient, complements, courbeCouts, aucunSalaire: photoReference == null };
}

function anneesPaie(co: DonneesCouts) {
  return [...new Set([...co.stats, ...co.lignes].map((l) => Number(l.annee)))].sort();
}

export async function coutsTendance(d: DonneesAnalyse, p: { year: number; scope?: Perimetre }, maintenant = new Date()) {
  const [eff, co] = await Promise.all([d.effectifs(), d.couts()]);
  if (!anneesPaie(co).includes(p.year) && !co.bruts.size) return { error: `No payroll data. Payroll years: ${anneesPaie(co).join(", ") || "none"}.` };
  const perimetre = p.scope ?? "all";
  const k = contexteCouts(d, eff, co, p.year, perimetre, maintenant);
  const decomposition = decomposerParMois(k.lignesAnnee, p.year, k.codesPerimetre);
  const lignesPerimetre = k.lignesAnnee.filter((l) => !k.codesPerimetre || k.codesPerimetre.has(l.code_salarie));
  const natures = decomposerParNature(lignesPerimetre);
  return {
    year: p.year,
    scope: perimetreEn(perimetre),
    definition:
      "Contractual employer cost = each person's full-time gross salary index × FTE × (1 + recurring complements rate) × employer charges coefficient, chained like the FTE curve: under contract → after suspensions → after CNS sick leave → paid → available (after MCT) → after holidays; the gaps are the cost of absences. 'Actual' = payroll employer cost of the month (gross + employer charges). Projected months reuse the latest salaries and rates.",
    employer_charges_coefficient: Math.round(k.coefficient.coef * 1000) / 1000,
    salaries_available: !k.aucunSalaire,
    by_month: k.courbeCouts.map((pc, i) => ({
      month: libelleMois(i + 1, p.year),
      status: pc.point.is_projection ? "projected" : pc.point.reporte?.brut ? "carried over from an earlier roster" : "actual",
      contractual_cost_under_contract_eur: eur(pc.point.effectif_brut),
      after_suspensions_eur: eur(pc.point.effectif_net),
      after_cns_sick_leave_eur: eur(pc.point.effectif_reel),
      paid_eur: eur(pc.point.effectif_apres_injustifiees ?? pc.point.projected_apres_injustifiees),
      available_eur: eur(pc.point.effectif_apres_mct ?? pc.point.projected_apres_mct),
      available_after_leave_eur: eur(pc.point.effectif_apres_conges ?? pc.point.projected_apres_conges),
      average_cost_per_fte_eur: eur(pc.couts.coutMoyenEtp),
      actual_payroll_employer_cost_eur: pc.realise.mesure ? eur(pc.realise.employeurMesure ? pc.realise.employeur : pc.realise.brut * k.coefficient.coef) : null,
      actual_payroll_gross_eur: pc.realise.mesure ? eur(pc.realise.brut) : null,
      actual_cost_estimated_from_coefficient: pc.realise.mesure && !pc.realise.employeurMesure,
    })),
    annual_contractual_payroll_eur: eur(k.courbeCouts.reduce((s, pc) => s + pc.point.effectif_brut, 0)),
    pay_families_by_month_eur: decomposition.map((m) => ({ month: libelleMois(m.mois, p.year), gross_paid_eur: eur(m.brut), ...familles(m.familles) })),
    pay_families_definition: FAMILLES_EN,
    year_to_date_pay_items_eur: NATURES.filter((n) => Math.abs(natures.get(n.cle) ?? 0) >= 1).map((n) => ({ item: n.libelle, family: n.famille, amount_eur: eur(natures.get(n.cle)) })),
    notes: ["Pay item labels are the French payroll labels (e.g. 'Heures sup. majorées' = paid overtime, 'Amplitude > 11 h' = long-day premium, 'Prime de 6e jour' = 6th-day premium)."],
  };
}

export async function coutsParDepot(d: DonneesAnalyse, p: { year: number; month: number; scope?: Perimetre }, maintenant = new Date()) {
  const [eff, co] = await Promise.all([d.effectifs(), d.couts()]);
  const perimetre = p.scope ?? "all";
  const k = contexteCouts(d, eff, co, p.year, perimetre, maintenant);
  const lignesDuMois = k.lignesAnnee.filter((l) => Number(l.mois) === p.month && (!k.codesPerimetre || k.codesPerimetre.has(l.code_salarie)));
  if (lignesDuMois.length === 0) return { error: `No detailed payroll for ${libelleMois(p.month, p.year)}. Payroll years: ${anneesPaie(co).join(", ")}.` };
  const depotParCode = new Map(k.c.photos.photoDuMois(p.month).map((e) => [e.code_salarie, e.description_service || ""]));
  const ligne = (v: VentilationLigne, libelle: string) => {
    const moyenne = v.salaries >= SEUIL_MOYENNE_SALAIRE;
    return {
      group: libelle,
      employees: v.salaries,
      gross_paid_eur: eur(v.brut),
      planning_related_eur: eur(v.familles.planning),
      planning_share_pct: v.partPlanning == null ? null : r1(v.partPlanning),
      gross_per_employee_eur: moyenne ? eur(v.brut / v.salaries) : null,
      planning_related_per_employee_eur: moyenne ? eur(v.familles.planning / v.salaries) : null,
    };
  };
  const parDepot = fusionnerSousSeuil(ventilerPar(lignesDuMois, (l) => depotParCode.get(l.code_salarie), "(not in roster)"), "Other depots");
  const chauffeurs = lignesDuMois.filter((l) => estChauffeur(l.fonction));
  const parFonction = fusionnerSousSeuil(ventilerPar(chauffeurs, (l) => l.fonction, "(no function)"), "Other driver functions");
  const total = ventilerPar(lignesDuMois, () => "Total")[0];
  return {
    year: p.year,
    month: libelleMois(p.month, p.year),
    scope: perimetreEn(perimetre),
    definition: "Payroll of the month (detailed salary list) split by depot (from the roster of the month) and by driver function: gross paid, planning-related pay (overtime, long-day premiums, 6th days, night/Sunday/holiday supplements) and its share of gross.",
    overall: ligne(total, "Total"),
    by_depot: parDepot.map((v) => ligne(v, nomDepot(v.cle))),
    drivers_by_function: parFonction.map((v) => ligne(v, v.cle)),
    excluded: `Depots and functions under ${SEUIL_MOYENNE_SALAIRE} employees are merged into 'Other' (a small group's total would reveal individual pay). No individual salary, minimum, maximum or median is given.`,
  };
}

export async function coutsInterim(d: DonneesAnalyse, p: { year: number; month?: number }) {
  const co = await d.couts();
  const moisDispo = [...new Set(co.interimCouts.filter((c) => c.annee === p.year).map((c) => c.mois))].sort((a, b) => a - b);
  if (moisDispo.length === 0) {
    const annees = [...new Set(co.interimCouts.map((c) => c.annee))].sort();
    return { error: `No interim cost data for ${p.year}. Interim years: ${annees.join(", ") || "none"}.` };
  }
  const moisRetenus = p.month ? moisDispo.filter((m) => m === p.month) : moisDispo;
  // Dépôt = service du roster intérim (le cost center reste l'axe de la page Coûts)
  const rosterParDepot = co.interimRoster.map((r) => ({ ...r, centre_cout: r.description_service || "(not linked)" }));
  const intervenants = (m: number) => new Set(co.interimCouts.filter((c) => c.annee === p.year && c.mois === m).map((c) => c.code_salarie)).size;
  const parMois = moisRetenus.map((m) => {
    const lignes = agregerInterimParCostCenter(co.interimCouts, co.interimRoster, p.year, m);
    return {
      month: libelleMois(m, p.year),
      cost_eur: eur(lignes.reduce((s, l) => s + l.montant, 0)),
      hours: Math.round(lignes.reduce((s, l) => s + l.heures, 0)),
      fte: r1(lignes.reduce((s, l) => s + l.etp, 0)),
      workers: intervenants(m),
    };
  });
  const parDepot = new Map<string, { montant: number; heures: number; etp: number; codes: Set<string> }>();
  const composantes = new Map<string, number>();
  moisRetenus.forEach((m) => {
    agregerInterimParCostCenter(co.interimCouts, rosterParDepot, p.year, m).forEach((l) => {
      const v = parDepot.get(l.centre_cout) ?? { montant: 0, heures: 0, etp: 0, codes: new Set<string>() };
      v.montant += l.montant;
      v.heures += l.heures;
      v.etp += l.etp;
      parDepot.set(l.centre_cout, v);
      Object.entries(l.composantes).forEach(([k, c]) => composantes.set(k, (composantes.get(k) ?? 0) + c.montant));
    });
    // Intervenants distincts par dépôt sur la période (pour la fusion des petits groupes)
    const rattachement = new Map(rosterParDepot.filter((r) => r.annee === p.year && r.mois === m).map((r) => [r.code_salarie, r.centre_cout]));
    co.interimCouts.filter((c) => c.annee === p.year && c.mois === m).forEach((c) => parDepot.get(rattachement.get(c.code_salarie) ?? "(non rattaché)")?.codes.add(c.code_salarie));
  });
  const depots = regrouperPetitsGroupes(
    [...parDepot].map(([depot, v]) => ({ depot, ...v, workers: v.codes.size })),
    (g) => g.workers,
    (petits) => ({ depot: `Other depots (${petits.length})`, montant: petits.reduce((s, g) => s + g.montant, 0), heures: petits.reduce((s, g) => s + g.heures, 0), etp: petits.reduce((s, g) => s + g.etp, 0), codes: new Set<string>(), workers: petits.reduce((s, g) => s + g.workers, 0) })
  );
  return {
    year: p.year,
    period: moisRetenus.length === 1 ? libelleMois(moisRetenus[0], p.year) : `${libelleMois(moisRetenus[0], p.year)} to ${libelleMois(moisRetenus.at(-1)!, p.year)}`,
    definition: "Expected interim cost billed by SLG Intérim (billable amount), hours worked (base component, overtime included) and FTE = hours / full-time hours of the month; depot from the interim roster.",
    by_month: parMois,
    total: { cost_eur: eur(parMois.reduce((s, m) => s + (m.cost_eur ?? 0), 0)), hours: parMois.reduce((s, m) => s + m.hours, 0) },
    by_depot: depots.map((g) => ({ depot: nomDepot(g.depot), cost_eur: eur(g.montant), hours: Math.round(g.heures), fte_month_sum: r1(g.etp), workers: g.workers })).sort((a, b) => (b.cost_eur ?? 0) - (a.cost_eur ?? 0)),
    by_component_eur: Object.fromEntries([...composantes].map(([k, v]) => [k, eur(v)])),
    excluded: `Depots with fewer than ${SEUIL_ANONYMAT} interim workers merged into 'Other depots'.`,
  };
}

