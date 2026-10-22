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
