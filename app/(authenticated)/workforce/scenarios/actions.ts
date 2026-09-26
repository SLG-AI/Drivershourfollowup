"use server";
import { getLatestRosterPeriod } from "@/lib/utils/roster-period";

import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { revalidatePath } from "next/cache";
import { lastDayOfMonth } from "@/lib/utils/wp-calculations";
import { MODE_PAR_TYPE, type ModeLevier, type TypeLevier } from "@/lib/utils/wp-leviers-cout";

interface MonthlyParamInput {
  mois: number;
  projected_absenteeism_rate: number;
  centre_cout?: string | null;
}

interface MonthlyTurnoverParamInput {
  mois: number;
  projected_turnover_rate: number;
  centre_cout?: string | null;
}

interface MonthlyLeaveParamInput {
  mois: number;
  projected_leave_rate: number;
  centre_cout?: string | null;
}

interface CreateScenarioInput {
  name: string;
  description: string;
  projected_turnover_rate: number;
  monthly_params: MonthlyParamInput[];
  monthly_turnover_params?: MonthlyTurnoverParamInput[];
  monthly_leave_params?: MonthlyLeaveParamInput[];
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
      centre_cout: mp.centre_cout ?? null,
    }));

    const { error: paramError } = await supabase
      .from("wp_scenario_monthly_params")
      .insert(params);

    if (paramError) throw new Error("Erreur paramètres mensuels: " + paramError.message);
  }

  // Insert monthly turnover params
  if (input.monthly_turnover_params && input.monthly_turnover_params.length > 0) {
    const turnoverParams = input.monthly_turnover_params.map((tp) => ({
      scenario_id: scenario.id,
      mois: tp.mois,
      projected_turnover_rate: tp.projected_turnover_rate,
      centre_cout: tp.centre_cout ?? null,
    }));

    const { error: tpError } = await supabase
      .from("wp_scenario_monthly_turnover_params")
      .insert(turnoverParams);

    if (tpError) throw new Error("Erreur paramètres turnover mensuels: " + tpError.message);
  }

  // Insert monthly leave params
  if (input.monthly_leave_params && input.monthly_leave_params.length > 0) {
    const leaveParams = input.monthly_leave_params.map((lp) => ({
      scenario_id: scenario.id,
      mois: lp.mois,
      projected_leave_rate: lp.projected_leave_rate,
      centre_cout: lp.centre_cout ?? null,
    }));

    const { error: lpError } = await supabase
      .from("wp_scenario_monthly_leave_params")
      .insert(leaveParams);

    if (lpError) throw new Error("Erreur paramètres congés mensuels: " + lpError.message);
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
      centre_cout: mp.centre_cout ?? null,
    }));

    const { error: paramError } = await supabase
      .from("wp_scenario_monthly_params")
      .insert(params);

    if (paramError) throw new Error("Erreur paramètres mensuels: " + paramError.message);
  }

  // Delete and re-insert monthly turnover params
  await supabase
    .from("wp_scenario_monthly_turnover_params")
    .delete()
    .eq("scenario_id", id);

  if (input.monthly_turnover_params && input.monthly_turnover_params.length > 0) {
    const turnoverParams = input.monthly_turnover_params.map((tp) => ({
      scenario_id: id,
      mois: tp.mois,
      projected_turnover_rate: tp.projected_turnover_rate,
      centre_cout: tp.centre_cout ?? null,
    }));

    const { error: tpError } = await supabase
      .from("wp_scenario_monthly_turnover_params")
      .insert(turnoverParams);

    if (tpError) throw new Error("Erreur paramètres turnover mensuels: " + tpError.message);
  }

  // Delete and re-insert monthly leave params
  await supabase
    .from("wp_scenario_monthly_leave_params")
    .delete()
    .eq("scenario_id", id);

  if (input.monthly_leave_params && input.monthly_leave_params.length > 0) {
    const leaveParams = input.monthly_leave_params.map((lp) => ({
      scenario_id: id,
      mois: lp.mois,
      projected_leave_rate: lp.projected_leave_rate,
      centre_cout: lp.centre_cout ?? null,
    }));

    const { error: lpError } = await supabase
      .from("wp_scenario_monthly_leave_params")
      .insert(leaveParams);

    if (lpError) throw new Error("Erreur paramètres congés mensuels: " + lpError.message);
  }

  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
  return { success: true };
}

export async function duplicateScenario(sourceId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");

  // Fetch source scenario
  const { data: source, error: srcErr } = await supabase
    .from("wp_scenarios")
    .select("*")
    .eq("id", sourceId)
    .single();
  if (srcErr || !source) throw new Error("Scénario source introuvable");

  // Create new scenario
  const { data: newScenario, error: createErr } = await supabase
    .from("wp_scenarios")
    .insert({
      name: `${source.name} (copie)`,
      description: source.description,
      projected_turnover_rate: source.projected_turnover_rate,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (createErr) throw new Error("Erreur duplication: " + createErr.message);

  const newId = newScenario.id;

  // Copy monthly params
  const monthlyParams = await fetchAll(
    supabase.from("wp_scenario_monthly_params").select("*").eq("scenario_id", sourceId)
  );
  if (monthlyParams.length > 0) {
    await supabase.from("wp_scenario_monthly_params").insert(
      monthlyParams.map((p) => ({ scenario_id: newId, mois: p.mois, projected_absenteeism_rate: p.projected_absenteeism_rate, centre_cout: p.centre_cout }))
    );
  }

  // Copy monthly turnover params
  const turnoverParams = await fetchAll(
    supabase.from("wp_scenario_monthly_turnover_params").select("*").eq("scenario_id", sourceId)
  );
  if (turnoverParams.length > 0) {
    await supabase.from("wp_scenario_monthly_turnover_params").insert(
      turnoverParams.map((p) => ({ scenario_id: newId, mois: p.mois, projected_turnover_rate: p.projected_turnover_rate, centre_cout: p.centre_cout }))
    );
  }

  // Copy arrival hypotheses
  const arrivals = await fetchAll(
    supabase.from("wp_scenario_arrival_hypotheses").select("*").eq("scenario_id", sourceId)
  );
  if (arrivals.length > 0) {
    await supabase.from("wp_scenario_arrival_hypotheses").insert(
      arrivals.map(({ id: _id, scenario_id: _sid, created_at: _ca, ...rest }) => ({ scenario_id: newId, ...rest }))
    );
  }

  // Copy departure hypotheses
  const departures = await fetchAll(
    supabase.from("wp_scenario_departures").select("*").eq("scenario_id", sourceId)
  );
  if (departures.length > 0) {
    await supabase.from("wp_scenario_departures").insert(
      departures.map(({ id: _id, scenario_id: _sid, created_at: _ca, ...rest }) => ({ scenario_id: newId, ...rest }))
    );
  }

  // Copy temp exit hypotheses
  const tempExits = await fetchAll(
    supabase.from("wp_scenario_temp_exit_hypotheses").select("*").eq("scenario_id", sourceId)
  );
  if (tempExits.length > 0) {
    await supabase.from("wp_scenario_temp_exit_hypotheses").insert(
      tempExits.map(({ id: _id, scenario_id: _sid, created_at: _ca, ...rest }) => ({ scenario_id: newId, ...rest }))
    );
  }

  // Copy leave params
  const leaveParams = await fetchAll(
    supabase.from("wp_scenario_monthly_leave_params").select("*").eq("scenario_id", sourceId)
  );
  if (leaveParams.length > 0) {
    await supabase.from("wp_scenario_monthly_leave_params").insert(
      leaveParams.map((p) => ({ scenario_id: newId, mois: p.mois, projected_leave_rate: p.projected_leave_rate, centre_cout: p.centre_cout }))
    );
  }

  // Copy cost levers
  const costParams = await fetchAll(
    supabase.from("wp_scenario_cost_params").select("*").eq("scenario_id", sourceId)
  );
  if (costParams.length > 0) {
    await supabase.from("wp_scenario_cost_params").insert(
      costParams.map(({ id: _id, scenario_id: _sid, created_at: _ca, ...rest }) => ({ scenario_id: newId, ...rest }))
    );
  }

  revalidatePath("/", "layout");
  return { id: newId };
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

  const [{ data: scenario }, { data: monthlyParams }, { data: monthlyTurnoverParams }, { data: departures }, { data: arrivalHypotheses }] = await Promise.all([
    supabase.from("wp_scenarios").select("*").eq("id", id).single(),
    supabase.from("wp_scenario_monthly_params").select("*").eq("scenario_id", id).order("mois"),
    supabase.from("wp_scenario_monthly_turnover_params").select("*").eq("scenario_id", id).order("mois"),
    supabase.from("wp_scenario_departures").select("*").eq("scenario_id", id).order("departure_month"),
    supabase.from("wp_scenario_arrival_hypotheses").select("*").eq("scenario_id", id).order("start_year, start_month"),
  ]);

  return {
    scenario,
    monthlyParams: monthlyParams || [],
    monthlyTurnoverParams: monthlyTurnoverParams || [],
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
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
  return { success: true };
}

export async function deleteArrivalHypothesis(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");

  // Check row exists and is accessible
  const { data: before } = await supabase
    .from("wp_scenario_arrival_hypotheses")
    .select("id, scenario_id")
    .eq("id", id)
    .single();

  if (!before) throw new Error("Hypothèse introuvable ou accès refusé");

  const { error } = await supabase
    .from("wp_scenario_arrival_hypotheses")
    .delete()
    .eq("id", id)
    .select();

  if (error) throw new Error("Erreur suppression hypothèse: " + error.message);

  // Verify deletion
  const { data: after } = await supabase
    .from("wp_scenario_arrival_hypotheses")
    .select("id")
    .eq("id", id)
    .single();

  if (after) throw new Error("La suppression a échoué silencieusement - la ligne existe toujours");

  revalidatePath("/", "layout");
  return { success: true };
}

// ============================================================
// Cost levers CRUD (wp_scenario_cost_params)
// ============================================================

interface CostParamInput {
  type: TypeLevier;
  centre_cout: string | null;
  annee_effet: number;
  mois_effet: number;
  valeur: number;
  mode: ModeLevier;
  libelle: string | null;
}

/**
 * Garde serveur : la base impose déjà la cohérence type/mode, mais un message
 * en français vaut mieux qu'une violation de contrainte.
 */
function validerCostParam(data: CostParamInput): CostParamInput {
  const modes = MODE_PAR_TYPE[data.type];
  if (!modes) throw new Error("Type de levier inconnu");
  if (!modes.includes(data.mode)) throw new Error("Mode incompatible avec le type de levier");
  const valeur = Number(data.valeur);
  if (!Number.isFinite(valeur)) throw new Error("La valeur doit être un nombre");
  const mois = Number(data.mois_effet);
  const annee = Number(data.annee_effet);
  if (!Number.isInteger(mois) || mois < 1 || mois > 12) throw new Error("Mois d'effet invalide");
  if (!Number.isInteger(annee) || annee < 2000 || annee > 2100) throw new Error("Année d'effet invalide");
  const centre = data.centre_cout?.trim() || null;
  const libelle = data.libelle?.trim() || null;
  return { type: data.type, centre_cout: centre, annee_effet: annee, mois_effet: mois, valeur, mode: data.mode, libelle };
}

export async function addCostParam(scenarioId: string, data: CostParamInput) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");

  const { data: result, error } = await supabase
    .from("wp_scenario_cost_params")
    .insert({ scenario_id: scenarioId, ...validerCostParam(data) })
    .select()
    .single();

  if (error) throw new Error("Erreur ajout levier de coût: " + error.message);
  revalidatePath("/", "layout");
  return result;
}

export async function updateCostParam(id: string, data: CostParamInput) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");

  const { error } = await supabase
    .from("wp_scenario_cost_params")
    .update(validerCostParam(data))
    .eq("id", id);

  if (error) throw new Error("Erreur mise à jour levier de coût: " + error.message);
  revalidatePath("/", "layout");
  return { success: true };
}

export async function deleteCostParam(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");

  const { error } = await supabase
    .from("wp_scenario_cost_params")
    .delete()
    .eq("id", id);

  if (error) throw new Error("Erreur suppression levier de coût: " + error.message);
  revalidatePath("/", "layout");
  return { success: true };
}

// ============================================================
// Temp exit hypotheses CRUD
// ============================================================

export async function addTempExitHypothesis(scenarioId: string, data: {
  nb_personnes: number;
  taux_occupation: number;
  fonction: string | null;
  centre_cout: string | null;
  depot: string | null;
  vehicle_type: string | null;
  motif: string;
  departure_day: number;
  departure_month: number;
  departure_year: number;
  return_day: number | null;
  return_month: number | null;
  return_year: number | null;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");

  const { data: result, error } = await supabase
    .from("wp_scenario_temp_exit_hypotheses")
    .insert({ scenario_id: scenarioId, ...data })
    .select()
    .single();

  if (error) throw new Error("Erreur ajout sortie temporaire: " + error.message);
  revalidatePath("/", "layout");
  return result;
}

export async function updateTempExitHypothesis(id: string, data: {
  nb_personnes: number;
  taux_occupation: number;
  fonction: string | null;
  centre_cout: string | null;
  depot: string | null;
  vehicle_type: string | null;
  motif: string;
  departure_day: number;
  departure_month: number;
  departure_year: number;
  return_day: number | null;
  return_month: number | null;
  return_year: number | null;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");

  const { error } = await supabase
    .from("wp_scenario_temp_exit_hypotheses")
    .update(data)
    .eq("id", id);

  if (error) throw new Error("Erreur mise à jour sortie temporaire: " + error.message);
  revalidatePath("/", "layout");
  return { success: true };
}

export async function deleteTempExitHypothesis(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");

  const { error } = await supabase
    .from("wp_scenario_temp_exit_hypotheses")
    .delete()
    .eq("id", id);

  if (error) throw new Error("Erreur suppression sortie temporaire: " + error.message);
  revalidatePath("/", "layout");
  return { success: true };
}

export async function getDistinctEmployeeValues() {
  const supabase = await createClient();

  // Roster historisé : on se cale sur la photographie la plus récente, sinon
  // les listes de filtres agrègent autant de mois qu'il y en a en base.
  const rosterPeriode = await getLatestRosterPeriod(supabase);
  const p = rosterPeriode;
  const [{ data: fonctions }, { data: centres }, { data: depots }] = await Promise.all([
    p
      ? supabase.from("wp_employees").select("description_fonction").not("description_fonction", "is", null).eq("mois", p.mois).eq("annee", p.annee)
      : supabase.from("wp_employees").select("description_fonction").limit(0),
    p
      ? supabase.from("wp_employees").select("centre_cout").not("centre_cout", "is", null).eq("mois", p.mois).eq("annee", p.annee)
      : supabase.from("wp_employees").select("centre_cout").limit(0),
    p
      ? supabase.from("wp_employees").select("description_service").not("description_service", "is", null).eq("mois", p.mois).eq("annee", p.annee)
      : supabase.from("wp_employees").select("description_service").limit(0),
  ]);

  const unique = (arr: { [key: string]: string | null }[] | null, key: string) =>
    [...new Set((arr || []).map((r) => r[key]).filter(Boolean) as string[])].sort();

  return {
    fonctions: unique(fonctions, "description_fonction"),
    centres_cout: unique(centres, "centre_cout"),
    depots: unique(depots, "description_service"),
  };
}

// ============================================================
// Departure hypotheses CRUD
// ============================================================

export async function addDepartureHypothesis(scenarioId: string, data: {
  code_salarie: string | null;
  nb_personnes: number;
  taux_occupation: number;
  fonction: string | null;
  centre_cout: string | null;
  depot: string | null;
  vehicle_type: string | null;
  departure_type: string;
  departure_day: number;
  departure_month: number;
  departure_year: number;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");

  const { data: result, error } = await supabase
    .from("wp_scenario_departures")
    .insert({ scenario_id: scenarioId, ...data, is_from_data: false })
    .select()
    .single();

  if (error) throw new Error("Erreur ajout hypothèse de départ: " + error.message);
  revalidatePath("/", "layout");
  return result;
}

export async function updateDepartureHypothesis(id: string, data: {
  code_salarie: string | null;
  nb_personnes: number;
  taux_occupation: number;
  fonction: string | null;
  centre_cout: string | null;
  depot: string | null;
  vehicle_type: string | null;
  departure_type: string;
  departure_day: number;
  departure_month: number;
  departure_year: number;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");

  const { error } = await supabase
    .from("wp_scenario_departures")
    .update(data)
    .eq("id", id);

  if (error) throw new Error("Erreur mise à jour hypothèse de départ: " + error.message);
  revalidatePath("/", "layout");
  return { success: true };
}

export async function deleteDepartureHypothesis(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");

  const { error } = await supabase
    .from("wp_scenario_departures")
    .delete()
    .eq("id", id);

  if (error) throw new Error("Erreur suppression hypothèse de départ: " + error.message);
  revalidatePath("/", "layout");
  return { success: true };
}
