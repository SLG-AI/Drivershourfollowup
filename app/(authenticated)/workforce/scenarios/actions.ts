"use server";

import { createClient } from "@/lib/supabase/server";

interface CreateScenarioInput {
  name: string;
  description: string;
  projected_turnover_rate: number;
  monthly_params: {
    mois: number;
    projected_absenteeism_rate: number;
  }[];
}

export async function createScenario(input: CreateScenarioInput) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");

  const { data: scenario, error } = await supabase
    .from("wp_scenarios")
    .insert({
      name: input.name,
      description: input.description,
      projected_turnover_rate: input.projected_turnover_rate,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) throw new Error("Erreur création scénario: " + error.message);

  // Insert monthly params
  if (input.monthly_params.length > 0) {
    const params = input.monthly_params.map((mp) => ({
      scenario_id: scenario.id,
      mois: mp.mois,
      projected_absenteeism_rate: mp.projected_absenteeism_rate,
    }));

    const { error: paramError } = await supabase
      .from("wp_scenario_monthly_params")
      .insert(params);

    if (paramError) throw new Error("Erreur paramètres mensuels: " + paramError.message);
  }

  return { id: scenario.id };
}

export async function updateScenario(id: string, input: CreateScenarioInput) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");

  const { error } = await supabase
    .from("wp_scenarios")
    .update({
      name: input.name,
      description: input.description,
      projected_turnover_rate: input.projected_turnover_rate,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw new Error("Erreur mise à jour scénario: " + error.message);

  // Delete and re-insert monthly params
  await supabase
    .from("wp_scenario_monthly_params")
    .delete()
    .eq("scenario_id", id);

  if (input.monthly_params.length > 0) {
    const params = input.monthly_params.map((mp) => ({
      scenario_id: id,
      mois: mp.mois,
      projected_absenteeism_rate: mp.projected_absenteeism_rate,
    }));

    const { error: paramError } = await supabase
      .from("wp_scenario_monthly_params")
      .insert(params);

    if (paramError) throw new Error("Erreur paramètres mensuels: " + paramError.message);
  }

  return { success: true };
}

export async function deleteScenario(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");

  const { error } = await supabase
    .from("wp_scenarios")
    .delete()
    .eq("id", id);

  if (error) throw new Error("Erreur suppression scénario: " + error.message);
  return { success: true };
}

export async function getScenarios() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("wp_scenarios")
    .select("*")
    .order("created_at", { ascending: false });
  return data || [];
}

export async function getScenarioWithParams(id: string) {
  const supabase = await createClient();

  const [{ data: scenario }, { data: monthlyParams }, { data: departures }, { data: arrivalHypotheses }] = await Promise.all([
    supabase.from("wp_scenarios").select("*").eq("id", id).single(),
    supabase.from("wp_scenario_monthly_params").select("*").eq("scenario_id", id).order("mois"),
    supabase.from("wp_scenario_departures").select("*").eq("scenario_id", id).order("departure_month"),
    supabase.from("wp_scenario_arrival_hypotheses").select("*").eq("scenario_id", id).order("start_year, start_month"),
  ]);

  return {
    scenario,
    monthlyParams: monthlyParams || [],
    departures: departures || [],
    arrivalHypotheses: arrivalHypotheses || [],
  };
}

// ============================================================
// Arrival hypotheses CRUD
// ============================================================

export async function addArrivalHypothesis(scenarioId: string, data: {
  nb_personnes: number;
  taux_occupation: number;
  fonction: string | null;
  centre_cout: string | null;
  depot: string | null;
  type_contrat: string;
  vehicle_type: string | null;
  start_day: number;
  start_month: number;
  start_year: number;
  end_day: number | null;
  end_month: number | null;
  end_year: number | null;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");

  const { data: result, error } = await supabase
    .from("wp_scenario_arrival_hypotheses")
    .insert({ scenario_id: scenarioId, ...data })
    .select()
    .single();

  if (error) throw new Error("Erreur ajout hypothèse: " + error.message);
  return result;
}

export async function updateArrivalHypothesis(id: string, data: {
  nb_personnes: number;
  taux_occupation: number;
  fonction: string | null;
  centre_cout: string | null;
  depot: string | null;
  type_contrat: string;
  vehicle_type: string | null;
  start_day: number;
  start_month: number;
  start_year: number;
  end_day: number | null;
  end_month: number | null;
  end_year: number | null;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");

  const { error } = await supabase
    .from("wp_scenario_arrival_hypotheses")
    .update(data)
    .eq("id", id);

  if (error) throw new Error("Erreur mise à jour hypothèse: " + error.message);
  return { success: true };
}

export async function deleteArrivalHypothesis(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");

  const { error } = await supabase
    .from("wp_scenario_arrival_hypotheses")
    .delete()
    .eq("id", id);

  if (error) throw new Error("Erreur suppression hypothèse: " + error.message);
  return { success: true };
}

export async function getDistinctEmployeeValues() {
  const supabase = await createClient();

  const [{ data: fonctions }, { data: centres }, { data: depots }] = await Promise.all([
    supabase.from("wp_employees").select("description_fonction").not("description_fonction", "is", null),
    supabase.from("wp_employees").select("centre_cout").not("centre_cout", "is", null),
    supabase.from("wp_employees").select("description_service").not("description_service", "is", null),
  ]);

  const unique = (arr: { [key: string]: string | null }[] | null, key: string) =>
    [...new Set((arr || []).map((r) => r[key]).filter(Boolean) as string[])].sort();

  return {
    fonctions: unique(fonctions, "description_fonction"),
    centres_cout: unique(centres, "centre_cout"),
    depots: unique(depots, "description_service"),
  };
}

export async function addScenarioDeparture(scenarioId: string, departure: {
  code_salarie: string | null;
  departure_type: string;
  departure_month: number;
  departure_year: number;
  return_month: number | null;
  return_year: number | null;
  vehicle_type: string | null;
  depot: string | null;
  is_from_data: boolean;
}) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("wp_scenario_departures")
    .insert({ scenario_id: scenarioId, ...departure });

  if (error) throw new Error("Erreur ajout départ: " + error.message);
  return { success: true };
}

export async function autoPopulateDepartures(scenarioId: string, year: number) {
  const supabase = await createClient();

  // Get employees with future exit dates
  const today = new Date().toISOString().split("T")[0];
  const { data: employees } = await supabase
    .from("wp_employees")
    .select("code_salarie, date_sortie, vehicle_type, description_motif_sortie, description_departement")
    .not("date_sortie", "is", null)
    .gte("date_sortie", today);

  if (!employees || employees.length === 0) return { count: 0 };

  // Clear existing auto-detected departures
  await supabase
    .from("wp_scenario_departures")
    .delete()
    .eq("scenario_id", scenarioId)
    .eq("is_from_data", true);

  const departures = employees
    .filter((e) => {
      const d = new Date(e.date_sortie!);
      return d.getFullYear() === year;
    })
    .map((e) => {
      const exitDate = new Date(e.date_sortie!);
      const motif = e.description_motif_sortie || "";

      let departureType = "end_contract";
      if (motif.toLowerCase().includes("retraite") || motif.toLowerCase().includes("pension")) departureType = "retirement";
      else if (motif.toLowerCase().includes("parental")) departureType = "temp_exit_parental";
      else if (motif.toLowerCase().includes("maternit")) departureType = "temp_exit_maternity";
      else if (motif.toLowerCase().includes("congé sans") || motif.toLowerCase().includes("accompagnement")) departureType = "temp_exit_other";
      else if (motif.toLowerCase().includes("licenciement") || motif.toLowerCase().includes("demission") || motif.toLowerCase().includes("siliation")) departureType = "turnover";

      return {
        scenario_id: scenarioId,
        code_salarie: e.code_salarie,
        departure_type: departureType,
        departure_month: exitDate.getMonth() + 1,
        departure_year: exitDate.getFullYear(),
        return_month: null as number | null,
        return_year: null as number | null,
        vehicle_type: e.vehicle_type,
        depot: e.description_departement,
        is_from_data: true,
      };
    });

  if (departures.length > 0) {
    const { error } = await supabase
      .from("wp_scenario_departures")
      .insert(departures);
    if (error) throw new Error("Erreur insertion départs: " + error.message);
  }

  return { count: departures.length };
}
