/**
 * Données Workforce Planning de l'analyste IA, chargées À LA DEMANDE (au
 * premier outil Workforce appelé) : une analyse de pénibilité n'en a pas
 * besoin, et les congés comptent une ligne par salarié et par jour.
 *
 * Mêmes colonnes de calcul que les pages Workforce, JAMAIS de nom : ce qui
 * n'est pas lu ne peut pas fuir. Les photos complètes (dépôt, cost center,
 * véhicule) viennent de `DonneesAnalyse.photos`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { plafonnerTauxCns } from "@/lib/utils/wp-taux-cns";
import type { LigneConge } from "@/lib/utils/wp-conges";
import type { LigneCns, LigneHeures } from "@/lib/utils/wp-paliers";
import { rangPeriode } from "@/lib/utils/roster-period";
import type { LignePaieDetaillee, LigneStatSalariale } from "@/lib/utils/wp-couts";
import type { CoutInterim, RattachementInterim } from "@/lib/utils/wp-interim";
import { NATURES } from "@/lib/utils/wp-natures-paie";

/** Ligne CNS complète : les paliers comptent toutes les natures d'heures (maladie, accident, maternité…). */
export type LigneCnsComplete = LigneCns & { code_salarie: string; mois: number; annee: number };
export type LigneMctComplete = LigneHeures & { code_salarie: string; mois: number; annee: number; date_absence: string | null };
export type LigneInjComplete = LigneHeures & { code_salarie: string; mois: number; annee: number };
export type LigneCongeComplete = LigneConge & { mois: number; annee: number };

export interface ImportMct {
  mois: number;
  annee: number;
  imported_at: string;
  conges_chauffeurs_inclus: boolean | null;
}

export interface SortieStats {
  code_salarie: string;
  mois: number;
  annee: number;
  date_sortie: string | null;
}

export interface DonneesEffectifs {
  cns: LigneCnsComplete[];
  mct: LigneMctComplete[];
  injustifiees: LigneInjComplete[];
  conges: LigneCongeComplete[];
  importsMct: ImportMct[];
  /** Dates de sortie des statistiques salariales : 2e source des sorties constatées. */
  sortiesStats: SortieStats[];
}

const COLONNES_CNS = "code_salarie, mois, annee, pct_absenteisme, hrs_maladie, jours_maladie, hrs_accident, hrs_raisons_familiales, hrs_conge_accompagnement, hrs_maternite, hrs_accueil, heures_theoriques";

export async function chargerDonneesEffectifs(supabase: SupabaseClient): Promise<DonneesEffectifs> {
  const [cns, mct, injustifiees, conges, importsMct, sortiesStats] = await Promise.all([
    fetchAll(supabase.from("wp_absences").select(COLONNES_CNS).order("id")).then(plafonnerTauxCns),
    fetchAll(supabase.from("wp_absences_mct").select("code_salarie, mois, annee, date_absence, duree_hrs").order("id")),
    fetchAll(supabase.from("wp_absences_injustifiees").select("code_salarie, mois, annee, date_debut, date_fin, duree_hrs").order("id")),
    fetchAll(supabase.from("wp_conges").select("code_salarie, categorie, date_conge, duree_hrs, mois, annee").order("id")),
    fetchAll(supabase.from("wp_imports").select("mois, annee, imported_at, conges_chauffeurs_inclus").eq("file_type", "absences_mct").eq("status", "completed")),
    fetchAll(supabase.from("wp_salary_stats").select("code_salarie, mois, annee, date_sortie").not("date_sortie", "is", null).order("id")),
  ]);
  const num = <T extends Record<string, unknown>>(l: T) => ({ ...l, mois: Number(l.mois), annee: Number(l.annee) });
  return {
    cns: (cns as Record<string, unknown>[]).map(num) as unknown as LigneCnsComplete[],
    mct: (mct as Record<string, unknown>[]).map(num) as unknown as LigneMctComplete[],
    injustifiees: (injustifiees as Record<string, unknown>[]).map(num) as unknown as LigneInjComplete[],
    conges: (conges as Record<string, unknown>[]).map(num) as unknown as LigneCongeComplete[],
    importsMct: (importsMct as Record<string, unknown>[]).map(num) as unknown as ImportMct[],
    sortiesStats: (sortiesStats as Record<string, unknown>[]).map(num) as unknown as SortieStats[],
  };
}

/** Un chargement paresseux, mémoïsé : appelé par chaque outil, exécuté une seule fois. */
export function paresseux<T>(charger: () => Promise<T>): () => Promise<T> {
  let promesse: Promise<T> | null = null;
  return () => (promesse ??= charger().catch((e) => { promesse = null; throw e; }));
}

// ---------------------------------------------------------------- coûts (chargés au premier outil Coûts)

export interface DonneesCouts {
  /** Statistiques salariales (montants), toutes années. */
  stats: LigneStatSalariale[];
  /** Liste des salaires détaillée (natures de paie), toutes années. */
  lignes: LignePaieDetaillee[];
  /** Brut indice par photo : rang de période → code salarié → brut. Salaires individuels : jamais rendus tels quels. */
  bruts: Map<number, Map<string, number | null>>;
  interimCouts: CoutInterim[];
  interimRoster: RattachementInterim[];
}

const COLONNES_STATS = "code_salarie, mois, annee, date_sortie, centre_cout, hrs_supp, total_brut, brut_base, supplements, cout_total_secu, charges_patronales, cm_patronale, cp_patronale, assurance_accident, allocation_familiale, sante_travail, mutualite, cot_pat_autres";
const COLONNES_LIGNES = [
  "code_salarie, mois, annee, type_remuneration, centre_cout, fonction, brut_base, total_brut",
  "cm_patronale, cp_patronale, assurance_accident, sante_travail, mutualite, cot_pat_autres, charges_patronales, avantages_nature, cout_employeur",
  ...NATURES.map((n) => n.cle),
].join(", ");

export async function chargerDonneesCouts(supabase: SupabaseClient): Promise<DonneesCouts> {
  const [stats, lignes, bruts, interimCouts, interimRoster] = await Promise.all([
    fetchAll(supabase.from("wp_salary_stats").select(COLONNES_STATS).order("id")),
    fetchAll(supabase.from("wp_salary_lines").select(COLONNES_LIGNES).order("id")),
    fetchAll(supabase.from("wp_employees").select("code_salarie, mois, annee, brut_indice").order("id")),
    fetchAll(supabase.from("wp_interim_costs").select("code_salarie, mois, annee, composante, quantite, montant_facturable").order("id")),
    fetchAll(supabase.from("wp_interim_roster").select("code_salarie, mois, annee, type_contrat, code_employeur, centre_cout, description_service, description_fonction, description_equipe").order("id")),
  ]);
  const parRang = new Map<number, Map<string, number | null>>();
  (bruts as Record<string, unknown>[]).forEach((b) => {
    const r = rangPeriode({ mois: Number(b.mois), annee: Number(b.annee) });
    const m = parRang.get(r) ?? new Map<string, number | null>();
    m.set(String(b.code_salarie), b.brut_indice == null ? null : Number(b.brut_indice));
    parRang.set(r, m);
  });
  return {
    stats: stats as LigneStatSalariale[],
    lignes: lignes as unknown as LignePaieDetaillee[],
    bruts: parRang,
    interimCouts: (interimCouts as Record<string, unknown>[]).map((c) => ({
      code_salarie: String(c.code_salarie), mois: Number(c.mois), annee: Number(c.annee), composante: String(c.composante),
      quantite: Number(c.quantite) || 0, montant_facturable: Number(c.montant_facturable) || 0,
    })),
    interimRoster: (interimRoster as Record<string, unknown>[]).map((r) => ({ ...r, mois: Number(r.mois), annee: Number(r.annee) })) as RattachementInterim[],
  };
}

// ---------------------------------------------------------------- scénarios et cibles (chargés au premier outil Scénarios)

type Ligne = Record<string, unknown>;

export interface DonneesScenarios {
  scenarios: { id: string; name: string; is_default: boolean; updated_at: string | null }[];
  /** Lignes brutes des tables wp_scenario_*, comme les pages les passent au moteur de projection. */
  rows: { params: Ligne[]; turnoverParams: Ligne[]; leaveParams: Ligne[]; departures: Ligne[]; arrivals: Ligne[]; tempExits: Ligne[]; details: Ligne[] };
  leviers: Ligne[];
  cibles: { id: string; name: string; annee: number; updated_at: string | null }[];
  valeursCibles: { scenario_id: string; mois: number; depot: string; target_etp: number }[];
  /** Ancien système : un total sans mois ni année. */
  ciblesHistoriques: { depot: string | null; vehicle_type: string | null; target_headcount: number; target_etp: number | null }[];
}

export async function chargerDonneesScenarios(supabase: SupabaseClient): Promise<DonneesScenarios> {
  const [scenarios, params, turnoverParams, leaveParams, departures, arrivals, tempExits, leviers, cibles, valeurs, historiques] = await Promise.all([
    fetchAll(supabase.from("wp_scenarios").select("id, name, is_default, projected_turnover_rate, updated_at").order("id")),
    fetchAll(supabase.from("wp_scenario_monthly_params").select("id, scenario_id, mois, projected_absenteeism_rate, centre_cout").order("id")),
    fetchAll(supabase.from("wp_scenario_monthly_turnover_params").select("id, scenario_id, mois, projected_turnover_rate, centre_cout").order("id")),
    fetchAll(supabase.from("wp_scenario_monthly_leave_params").select("id, scenario_id, mois, projected_leave_rate, centre_cout").order("id")),
    // Sans code salarié : le moteur ne lit que dates, type, volume et affectation
    fetchAll(supabase.from("wp_scenario_departures").select("id, scenario_id, departure_type, departure_day, departure_month, departure_year, return_month, return_year, vehicle_type, depot, is_from_data, nb_personnes, taux_occupation, fonction, centre_cout").order("id")),
    fetchAll(supabase.from("wp_scenario_arrival_hypotheses").select("*").order("id")),
    fetchAll(supabase.from("wp_scenario_temp_exit_hypotheses").select("*").order("id")),
    fetchAll(supabase.from("wp_scenario_cost_params").select("*").order("id")),
    fetchAll(supabase.from("wp_target_scenarios").select("id, name, annee, updated_at").order("id")),
    fetchAll(supabase.from("wp_target_scenario_values").select("scenario_id, mois, depot, target_etp").order("id")),
    fetchAll(supabase.from("wp_target_needs").select("depot, vehicle_type, target_headcount, target_etp").order("id")),
  ]);
  return {
    scenarios: (scenarios as Ligne[]).map((s) => ({ id: String(s.id), name: String(s.name), is_default: s.is_default === true, updated_at: (s.updated_at as string) ?? null })),
    rows: { params, turnoverParams, leaveParams, departures, arrivals, tempExits, details: scenarios.map((s) => ({ id: s.id, projected_turnover_rate: s.projected_turnover_rate })) },
    leviers,
    cibles: (cibles as Ligne[]).map((c) => ({ id: String(c.id), name: String(c.name), annee: Number(c.annee), updated_at: (c.updated_at as string) ?? null })),
    valeursCibles: (valeurs as Ligne[]).map((v) => ({ scenario_id: String(v.scenario_id), mois: Number(v.mois), depot: String(v.depot), target_etp: Number(v.target_etp) })),
    ciblesHistoriques: (historiques as Ligne[]).map((t) => ({ depot: (t.depot as string) || null, vehicle_type: (t.vehicle_type as string) || null, target_headcount: Number(t.target_headcount), target_etp: t.target_etp == null ? null : Number(t.target_etp) })),
  };
}
