import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { notFound } from "next/navigation";
import { ScenarioEditorClient } from "./scenario-editor-client";
import { getDistinctEmployeeValues } from "../actions";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ year?: string }>;
}

export default async function ScenarioEditorPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { year: yearParam } = await searchParams;
  const supabase = await createClient();
  const selectedYear = yearParam ? parseInt(yearParam) : new Date().getFullYear();

  // Fetch scenario + params + departures + arrival hypotheses (paginated for large tables)
  const [
    { data: scenario },
    { data: monthlyParams },
    { data: departures },
    { data: arrivalHypotheses },
    { data: tempExitHypotheses },
    employees,
    absences,
    targets,
    comboboxOptions,
  ] = await Promise.all([
    supabase.from("wp_scenarios").select("*").eq("id", id).single(),
    supabase.from("wp_scenario_monthly_params").select("*").eq("scenario_id", id).order("mois"),
    supabase.from("wp_scenario_departures").select("*").eq("scenario_id", id).order("departure_month"),
    supabase.from("wp_scenario_arrival_hypotheses").select("*").eq("scenario_id", id).order("start_year, start_month"),
    supabase.from("wp_scenario_temp_exit_hypotheses").select("*").eq("scenario_id", id).order("departure_year, departure_month"),
    fetchAll(supabase.from("wp_employees").select("code_salarie, date_entree, date_sortie, vehicle_type, taux_occupation, est_sortie_temporaire, description_motif_sortie, description_departement, description_equipe")),
    fetchAll(supabase.from("wp_absences").select("code_salarie, mois, annee, pct_absenteisme, hrs_maladie, hrs_maternite, hrs_accident, heures_theoriques")),
    fetchAll(supabase.from("wp_target_needs").select("target_headcount")),
    getDistinctEmployeeValues(),
  ]);

  if (!scenario) notFound();

  const targetTotal = (targets || []).reduce((sum, t) => sum + Number(t.target_headcount), 0);

  return (
    <div className="space-y-6">
      <ScenarioEditorClient
        scenario={scenario}
        monthlyParams={monthlyParams || []}
        departures={departures || []}
        arrivalHypotheses={(arrivalHypotheses || []).map((h: Record<string, unknown>) => ({
          id: h.id as string,
          scenario_id: h.scenario_id as string,
          nb_personnes: Number(h.nb_personnes),
          taux_occupation: Number(h.taux_occupation),
          fonction: (h.fonction as string) || null,
          centre_cout: (h.centre_cout as string) || null,
          depot: (h.depot as string) || null,
          type_contrat: h.type_contrat as "CDI" | "CDD",
          vehicle_type: (h.vehicle_type as "BUS" | "CAM") || null,
          start_day: Number(h.start_day) || 1,
          start_month: Number(h.start_month),
          start_year: Number(h.start_year),
          end_day: h.end_day ? Number(h.end_day) : null,
          end_month: h.end_month ? Number(h.end_month) : null,
          end_year: h.end_year ? Number(h.end_year) : null,
        }))}
        tempExitHypotheses={(tempExitHypotheses || []).map((h: Record<string, unknown>) => ({
          id: h.id as string,
          scenario_id: h.scenario_id as string,
          nb_personnes: Number(h.nb_personnes),
          taux_occupation: Number(h.taux_occupation),
          fonction: (h.fonction as string) || null,
          centre_cout: (h.centre_cout as string) || null,
          depot: (h.depot as string) || null,
          vehicle_type: (h.vehicle_type as "BUS" | "CAM") || null,
          motif: (h.motif as string) || "Congé parental",
          departure_day: Number(h.departure_day) || 1,
          departure_month: Number(h.departure_month),
          departure_year: Number(h.departure_year),
          return_day: h.return_day ? Number(h.return_day) : null,
          return_month: h.return_month ? Number(h.return_month) : null,
          return_year: h.return_year ? Number(h.return_year) : null,
        }))}
        comboboxOptions={comboboxOptions}
        employees={(employees || []).map((e) => ({
          code_salarie: e.code_salarie,
          date_entree: e.date_entree,
          date_sortie: e.date_sortie,
          vehicle_type: e.vehicle_type,
          taux_occupation: Number(e.taux_occupation),
          est_sortie_temporaire: e.est_sortie_temporaire,
          description_motif_sortie: e.description_motif_sortie || "",
          description_departement: e.description_departement || "",
          description_equipe: e.description_equipe || "",
        }))}
        absences={(absences || []).map((a) => ({
          code_salarie: a.code_salarie,
          mois: Number(a.mois),
          annee: Number(a.annee),
          pct_absenteisme: Number(a.pct_absenteisme),
          hrs_maladie: Number(a.hrs_maladie),
          hrs_maternite: Number(a.hrs_maternite),
          hrs_accident: Number(a.hrs_accident),
          heures_theoriques: Number(a.heures_theoriques),
        }))}
        selectedYear={selectedYear}
        targetTotal={targetTotal > 0 ? targetTotal : undefined}
      />
    </div>
  );
}
