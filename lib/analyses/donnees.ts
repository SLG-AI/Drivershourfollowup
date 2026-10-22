/**
 * Chargement unique des données d'une analyse : tout ce que les outils
 * (`outils.ts`) agrègent, lu une fois en début de tâche. Les colonnes sont
 * réduites au nécessaire et AUCUN nom n'est chargé — les outils ne sortent
 * que des agrégats, mais ce qui n'est pas lu ne peut pas fuir.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { indexerPhotos, photoPourLeMois, type PhotosParRang } from "@/lib/utils/roster-photos";
import { plafonnerTauxCns } from "@/lib/utils/wp-taux-cns";
import type { AbsenceCns, AbsenceInjustifiee, AbsenceMct, LignePhotoAbsence } from "@/lib/utils/wp-absenteisme";
import type { LignePhotoTurnover, MouvementSortie } from "@/lib/utils/wp-turnover";
import { chargerDonneesCouts, chargerDonneesEffectifs, paresseux, type DonneesCouts, type DonneesEffectifs } from "./donnees-workforce";

export interface LignePaie {
  code_salarie: string;
  mois: number;
  annee: number;
  fonction: string | null;
  nat_am1: number;
  nat_am2: number;
  nat_prr: number;
}

export interface LigneHeures {
  code_salarie: string;
  mois: number;
  annee: number;
  vehicle_type: string | null;
  positive_hours: number;
  missing_hours: number;
  overtime_pay: number;
}

export type LignePhotoAnalyse = LignePhotoAbsence & LignePhotoTurnover & {
  description_fonction?: string | null;
  centre_cout?: string | null;
  vehicle_type?: string | null;
};

export interface DonneesAnalyse {
  paie: LignePaie[];
  heures: LigneHeures[];
  photos: PhotosParRang<LignePhotoAnalyse>;
  absencesCns: AbsenceCns[];
  absencesMct: AbsenceMct[];
  absencesInjustifiees: AbsenceInjustifiee[];
  mouvements: MouvementSortie[];
  /** Dépôt d'un salarié pour un mois, lu dans la photo de ce mois (mémoïsé). */
  depotDe: (code: string, mois: number, annee: number) => string | null;
  /** Absences complètes, congés, imports MCT : chargés au premier outil Workforce (voir donnees-workforce.ts). */
  effectifs: () => Promise<DonneesEffectifs>;
  /** Paie détaillée, bruts indices des photos, intérim : chargés au premier outil Coûts. */
  couts: () => Promise<DonneesCouts>;
}

const COLONNES_PHOTO = "code_salarie, mois, annee, date_entree, date_sortie, est_sortie_temporaire, date_debut_sortie_temporaire, date_fin_sortie_temporaire, description_motif_sortie, type_contrat, taux_occupation, description_service, description_fonction, centre_cout, vehicle_type";

export async function chargerDonnees(supabase: SupabaseClient): Promise<DonneesAnalyse> {
  const [paie, heuresBrutes, photosBrutes, absencesCns, absencesMct, absencesInjustifiees, mouvements] = await Promise.all([
    fetchAll(supabase.from("wp_salary_lines").select("code_salarie, mois, annee, fonction, nat_am1, nat_am2, nat_prr").order("id")),
    fetchAll(supabase.from("monthly_records").select("month, year, positive_hours, missing_hours, overtime_pay, drivers!inner(code_salarie, vehicle_type)").order("id")),
    fetchAll(supabase.from("wp_employees").select(COLONNES_PHOTO).order("id")),
    fetchAll(supabase.from("wp_absences").select("code_salarie, mois, annee, pct_absenteisme, hrs_maladie, jours_maladie").order("id")).then(plafonnerTauxCns),
    fetchAll(supabase.from("wp_absences_mct").select("code_salarie, date_absence, duree_hrs, mois, annee").order("id")),
    fetchAll(supabase.from("wp_absences_injustifiees").select("code_salarie, date_debut, date_fin, duree_hrs, mois, annee").order("id")),
    fetchAll(supabase.from("wp_mouvements").select("code_salarie, type, motif_sortie, date_sortie, mois, annee").order("id")),
  ]);

  const photos = indexerPhotos(photosBrutes as LignePhotoAnalyse[]);
  const depots = new Map<string, Map<string, string>>();
  const depotDe = (code: string, mois: number, annee: number) => {
    const cle = `${annee}-${mois}`;
    let parCode = depots.get(cle);
    if (!parCode) {
      parCode = new Map(photoPourLeMois(photos, mois, annee).lignes.map((e) => [e.code_salarie, e.description_service || ""]));
      depots.set(cle, parCode);
    }
    return parCode.get(code) || null;
  };

  return {
    paie: (paie as Record<string, unknown>[]).map((l) => ({
      code_salarie: String(l.code_salarie),
      mois: Number(l.mois),
      annee: Number(l.annee),
      fonction: (l.fonction as string | null) ?? null,
      nat_am1: Number(l.nat_am1 ?? 0),
      nat_am2: Number(l.nat_am2 ?? 0),
      nat_prr: Number(l.nat_prr ?? 0),
    })),
    heures: (heuresBrutes as Record<string, unknown>[]).map((h) => {
      const d = h.drivers as { code_salarie?: string; vehicle_type?: string } | { code_salarie?: string; vehicle_type?: string }[];
      const driver = Array.isArray(d) ? d[0] : d;
      return {
        code_salarie: String(driver?.code_salarie ?? ""),
        vehicle_type: driver?.vehicle_type ?? null,
        mois: Number(h.month),
        annee: Number(h.year),
        positive_hours: Number(h.positive_hours ?? 0),
        missing_hours: Number(h.missing_hours ?? 0),
        overtime_pay: Number(h.overtime_pay ?? 0),
      };
    }),
    photos,
    absencesCns: absencesCns as AbsenceCns[],
    absencesMct: absencesMct as AbsenceMct[],
    absencesInjustifiees: absencesInjustifiees as AbsenceInjustifiee[],
    mouvements: mouvements as MouvementSortie[],
    depotDe,
    effectifs: paresseux(() => chargerDonneesEffectifs(supabase)),
    couts: paresseux(() => chargerDonneesCouts(supabase)),
  };
}
