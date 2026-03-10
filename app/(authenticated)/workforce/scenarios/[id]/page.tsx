import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { notFound } from "next/navigation";
import { ScenarioEditorClient } from "./scenario-editor-client";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ year?: string }>;
}

export default async function ScenarioEditorPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { year: yearParam } = await searchParams;
  const supabase = await createClient();
  const selectedYear = yearParam ? parseInt(yearParam) : new Date().getFullYear();

  // Fetch scenario + params + departures (paginated for large tables)
  const [
    { data: scenario },
    { data: monthlyParams },
    { data: departures },
    employees,
    absences,
    targets,
  ] = await Promise.all([
    supabase.from("wp_scenarios").select("*").eq("id", id).single(),
    supabase.from("wp_scenario_monthly_params").select("*").eq("scenario_id", id).order("mois"),
    supabase.from("wp_scenario_departures").select("*").eq("scenario_id", id).order("departure_month"),
    fetchAll(supabase.from("wp_employees").select("code_salarie, date_entree, date_sortie, vehicle_type, taux_occupation, est_sortie_temporaire, description_motif_sortie, description_departement, description_equipe")),
    fetchAll(supabase.from("wp_absences").select("code_salarie, mois, annee, pct_absenteisme, hrs_maladie, hrs_maternite, hrs_accident, heures_theoriques")),
    fetchAll(supabase.from("wp_target_needs").select("target_headcount")),
  ]);

  if (!scenario) notFound();

  const targetTotal = (targets || []).reduce((sum, t) => sum + Number(t.target_headcount), 0);

  return (
    <div className="space-y-6">
      <ScenarioEditorClient
        scenario={scenario}
        monthlyParams={monthlyParams || []}
        departures={departures || []}
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
