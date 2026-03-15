"use server";

import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { revalidatePath } from "next/cache";

// ============================================================
// Legacy target needs (kept for backward compatibility)
// ============================================================

interface TargetInput {
  vehicle_type: string;
  depot: string;
  centre_cout: string;
  work_time: string;
  target_headcount: number;
  target_etp: number | null;
}

export async function upsertTargets(targets: TargetInput[]) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");

  await supabase
    .from("wp_target_needs")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");

  if (targets.length === 0) return { success: true, count: 0 };

  const rows = targets
    .filter((t) => t.target_headcount > 0)
    .map((t) => ({
      vehicle_type: t.vehicle_type || "",
      depot: t.depot || "",
      centre_cout: t.centre_cout || "",
      work_time: t.work_time,
      target_headcount: t.target_headcount,
      target_etp: t.target_etp,
      created_by: user.id,
    }));

  if (rows.length > 0) {
    const { error } = await supabase.from("wp_target_needs").insert(rows);
    if (error) throw new Error("Erreur sauvegarde cibles: " + error.message);
  }

  return { success: true, count: rows.length };
}

// ============================================================
// Target scenarios CRUD
// ============================================================

export async function createTargetScenario(input: { name: string; description: string }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");

  const { data: scenario, error } = await supabase
    .from("wp_target_scenarios")
    .insert({
      name: input.name,
      description: input.description,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) throw new Error("Erreur création scénario de besoins: " + error.message);
  revalidatePath("/", "layout");
  return { id: scenario.id };
}

export async function deleteTargetScenario(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");

  const { error } = await supabase
    .from("wp_target_scenarios")
    .delete()
    .eq("id", id);

  if (error) throw new Error("Erreur suppression: " + error.message);
  revalidatePath("/", "layout");
  return { success: true };
}

export async function duplicateTargetScenario(sourceId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");

  const { data: source, error: srcErr } = await supabase
    .from("wp_target_scenarios")
    .select("*")
    .eq("id", sourceId)
    .single();
  if (srcErr || !source) throw new Error("Scénario source introuvable");

  const { data: newScenario, error: createErr } = await supabase
    .from("wp_target_scenarios")
    .insert({
      name: `${source.name} (copie)`,
      description: source.description,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (createErr) throw new Error("Erreur duplication: " + createErr.message);

  const values = await fetchAll(
    supabase.from("wp_target_scenario_values").select("*").eq("scenario_id", sourceId)
  );
  if (values.length > 0) {
    await supabase.from("wp_target_scenario_values").insert(
      values.map((v) => ({ scenario_id: newScenario.id, mois: v.mois, depot: v.depot, target_etp: v.target_etp }))
    );
  }

  revalidatePath("/", "layout");
  return { id: newScenario.id };
}

export async function updateTargetScenario(
  id: string,
  input: {
    name: string;
    description: string;
    values: { mois: number; depot: string; target_etp: number }[];
  }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");

  const { error } = await supabase
    .from("wp_target_scenarios")
    .update({ name: input.name, description: input.description, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw new Error("Erreur mise à jour: " + error.message);

  // Delete and re-insert values
  await supabase
    .from("wp_target_scenario_values")
    .delete()
    .eq("scenario_id", id);

  if (input.values.length > 0) {
    const rows = input.values
      .filter((v) => v.target_etp > 0)
      .map((v) => ({
        scenario_id: id,
        mois: v.mois,
        depot: v.depot,
        target_etp: v.target_etp,
      }));

    if (rows.length > 0) {
      const { error: valError } = await supabase
        .from("wp_target_scenario_values")
        .insert(rows);
      if (valError) throw new Error("Erreur sauvegarde valeurs: " + valError.message);
    }
  }

  revalidatePath("/", "layout");
  return { success: true };
}

export async function computeProjectionByDepot(input: {
  scenarioIds: string[];
  turnoverSrcId: string | null;
  absSrcId: string | null;
  leaveSrcId: string | null;
  year: number;
}): Promise<{ depot: string; mois: number; etp: number }[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");

  const { scenarioIds, turnoverSrcId, absSrcId, leaveSrcId, year } = input;
  if (scenarioIds.length === 0) return [];

  // Fetch all needed data
  const [employees, absences, absencesMct, scenarioParams, scenarioTurnoverParams, scenarioLeaveParams, scenarioArrivals, scenarioDepartures, scenarioTempExits, scenarioDetails] = await Promise.all([
    fetchAll(supabase.from("wp_employees").select("*")),
    fetchAll(supabase.from("wp_absences").select("code_salarie, mois, annee, pct_absenteisme, hrs_maladie")),
    fetchAll(supabase.from("wp_absences_mct").select("code_salarie, mois, annee, duree_hrs")),
    fetchAll(supabase.from("wp_scenario_monthly_params").select("*").in("scenario_id", scenarioIds)),
    fetchAll(supabase.from("wp_scenario_monthly_turnover_params").select("*").in("scenario_id", scenarioIds)),
    fetchAll(supabase.from("wp_scenario_monthly_leave_params").select("*").in("scenario_id", scenarioIds)),
    fetchAll(supabase.from("wp_scenario_arrival_hypotheses").select("*").in("scenario_id", scenarioIds)),
    fetchAll(supabase.from("wp_scenario_departures").select("*").in("scenario_id", scenarioIds)),
    fetchAll(supabase.from("wp_scenario_temp_exit_hypotheses").select("*").in("scenario_id", scenarioIds)),
    fetchAll(supabase.from("wp_scenarios").select("id, projected_turnover_rate").in("id", scenarioIds)),
  ]);

  // Deduplicate employees by code_salarie (keep last imported)
  const employeeMap = new Map<string, Record<string, unknown>>();
  (employees as Record<string, unknown>[]).forEach((e) => {
    const code = e.code_salarie as string;
    if (code) employeeMap.set(code, e);
  });
  const dedupEmployees = Array.from(employeeMap.values());

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  function getEtp(e: Record<string, unknown>): number {
    return Number(e.taux_occupation || 100) / 100;
  }

  function lastDayOfMonth(y: number, m: number): string {
    return new Date(y, m, 0).toISOString().split("T")[0];
  }

  // Reclassification of temp exits (same logic as dashboard)
  function isCongeStructurel(motif: string): boolean {
    const m = motif.toLowerCase();
    return m.includes("parental") || m.includes("maternité") || m.includes("maternite")
      || m.includes("sans solde") || m.includes("accompagnement") || m.includes("dispense");
  }

  const codesAvecMaladieCns = new Set(
    absences.filter((a) => Number(a.hrs_maladie || 0) > 0).map((a) => a.code_salarie)
  );

  dedupEmployees.forEach((e) => {
    if (e.est_sortie_temporaire && !isCongeStructurel(String(e.description_motif_sortie || "")) && codesAvecMaladieCns.has(e.code_salarie as string)) {
      e.est_sortie_temporaire = false;
    }
    if (!e.est_sortie_temporaire && e.date_sortie && isCongeStructurel(String(e.description_motif_sortie || ""))) {
      e.est_sortie_temporaire = true;
    }
  });

  function getActiveAt(date: string) {
    return dedupEmployees.filter((e) => {
      if (!e.date_entree || (e.date_entree as string) > date) return false;
      if (!e.date_sortie) return true;
      if ((e.date_sortie as string) >= date) return true;
      if (e.est_sortie_temporaire && e.date_fin_sortie_temporaire && (e.date_fin_sortie_temporaire as string) >= date) return true;
      return false;
    });
  }

  function isTempExitAt(e: Record<string, unknown>, date: string): boolean {
    if (!e.est_sortie_temporaire || !e.date_sortie) return false;
    if ((e.date_sortie as string) > date) return false;
    if (!e.date_fin_sortie_temporaire) return true;
    return (e.date_fin_sortie_temporaire as string) >= date;
  }

  // Source scenario rates
  const turnoverSrcScId = turnoverSrcId && scenarioIds.includes(turnoverSrcId) ? turnoverSrcId : scenarioIds[0];
  const absSrcScId = absSrcId && scenarioIds.includes(absSrcId) ? absSrcId : scenarioIds[0];
  const leaveSrcScId = leaveSrcId && scenarioIds.includes(leaveSrcId) ? leaveSrcId : scenarioIds[0];

  // Absenteeism rates by month (global)
  const absSrcParams = scenarioParams.filter((p) => p.scenario_id === absSrcScId);
  const absGlobalByMonth = new Map<number, number>();
  absSrcParams.forEach((p) => {
    if (!p.centre_cout) absGlobalByMonth.set(Number(p.mois), Number(p.projected_absenteeism_rate));
  });

  // Turnover rates
  const turnoverDetail = scenarioDetails.find((s) => s.id === turnoverSrcScId);
  const turnoverFallback = Number(turnoverDetail?.projected_turnover_rate ?? 0);
  const turnoverSrcParams = scenarioTurnoverParams.filter((p) => p.scenario_id === turnoverSrcScId);
  const turnoverGlobalByMonth = new Map<number, number>();
  turnoverSrcParams.forEach((p) => {
    if (!p.centre_cout) turnoverGlobalByMonth.set(Number(p.mois), Number(p.projected_turnover_rate));
  });

  // Leave rates by month
  const leaveSrcParams = scenarioLeaveParams.filter((p) => p.scenario_id === leaveSrcScId);
  const leaveGlobalByMonth = new Map<number, number>();
  leaveSrcParams.forEach((p) => {
    if (!p.centre_cout) leaveGlobalByMonth.set(Number(p.mois), Number(p.projected_leave_rate));
  });

  // Get all depots
  const allDepots = new Set<string>();
  dedupEmployees.forEach((e) => {
    const depot = (e.description_service as string) || "Non assigné";
    allDepots.add(depot);
  });

  // Last known CNS and MCT rates
  let lastKnownCnsRate = 0;
  let lastKnownMctRate = 0;

  // Compute rates from real data
  for (let m = 1; m <= 12; m++) {
    const isReal = year < currentYear || (year === currentYear && m <= currentMonth);
    if (!isReal) break;
    const monthEnd = lastDayOfMonth(year, m);
    const active = getActiveAt(monthEnd);
    const nonTemp = active.filter((e) => !isTempExitAt(e, monthEnd));
    const netEtp = nonTemp.reduce((sum, e) => sum + getEtp(e), 0);

    const monthAbs = absences.filter((a) => Number(a.mois) === m && Number(a.annee) === year);
    if (monthAbs.length > 0 && netEtp > 0) {
      const tempCodes = new Set(active.filter((e) => isTempExitAt(e, monthEnd)).map((e) => e.code_salarie));
      const absentEtp = monthAbs.reduce((sum, a) => {
        if (tempCodes.has(a.code_salarie)) return sum;
        const etp = getEtp(employeeMap.get(a.code_salarie) || { taux_occupation: 100 });
        return sum + (Number(a.pct_absenteisme || 0) / 100) * etp;
      }, 0);
      lastKnownCnsRate = (absentEtp / netEtp) * 100;
    }

    const monthMct = absencesMct.filter((a) => Number(a.mois) === m && Number(a.annee) === year);
    if (monthMct.length > 0) {
      const totalMctHrs = monthMct.reduce((sum, a) => sum + Number(a.duree_hrs || 0), 0);
      const workableHrs = 173; // approximation
      const ftePerdus = totalMctHrs / workableHrs;
      const reelEtp = netEtp - (netEtp * lastKnownCnsRate / 100);
      if (reelEtp > 0) lastKnownMctRate = (ftePerdus / reelEtp) * 100;
    }
  }

  // Debug: log totals
  const jan31 = lastDayOfMonth(year, 1);
  const allActiveJan = getActiveAt(jan31);
  const totalEtpJan = allActiveJan.reduce((sum, e) => sum + getEtp(e), 0);

  const results: { depot: string; mois: number; etp: number }[] = [];

  for (const depot of allDepots) {
    const depotEmployees = dedupEmployees.filter((e) => ((e.description_service as string) || "Non assigné") === depot);

    // Compute avg net for leave pool
    let sumNetForPool = 0;

    for (let m = 1; m <= 12; m++) {
      const monthEnd = lastDayOfMonth(year, m);
      const isProjection = year > currentYear || (year === currentYear && m > currentMonth);

      const activeAtMonth = depotEmployees.filter((e) => {
        if (!e.date_entree || (e.date_entree as string) > monthEnd) return false;
        if (!e.date_sortie) return true;
        if ((e.date_sortie as string) >= monthEnd) return true;
        if (e.est_sortie_temporaire && e.date_fin_sortie_temporaire && (e.date_fin_sortie_temporaire as string) >= monthEnd) return true;
        return false;
      });

      const brutEtp = activeAtMonth.reduce((sum, e) => sum + getEtp(e), 0);
      const tempExitEtp = activeAtMonth.filter((e) => isTempExitAt(e, monthEnd)).reduce((sum, e) => sum + getEtp(e), 0);
      let netEtp = brutEtp - tempExitEtp;

      // For projected months, apply turnover
      if (isProjection) {
        const turnoverRate = turnoverGlobalByMonth.get(m) ?? turnoverFallback;
        const monthlyLoss = netEtp * (turnoverRate / 100 / 12);
        netEtp = Math.max(0, netEtp - monthlyLoss);
      }

      sumNetForPool += netEtp;

      // Apply CNS rate
      const cnsRate = lastKnownCnsRate;
      const reelEtp = netEtp - (netEtp * cnsRate / 100);

      // Apply MCT rate
      const mctRate = absGlobalByMonth.get(m) ?? lastKnownMctRate;
      const afterMctEtp = reelEtp - (netEtp * mctRate / 100);

      // Store net for leave pool computation (will apply leave after)
      results.push({ depot, mois: m, etp: Math.max(0, Math.round(afterMctEtp * 10) / 10) });
    }

    // Apply leave pool distribution
    const avgNet = sumNetForPool / 12;
    const leavePool = avgNet * 320 / 173;

    for (let m = 1; m <= 12; m++) {
      const leaveRate = leaveGlobalByMonth.get(m) ?? 0;
      const leaveFte = leavePool * (leaveRate / 100);
      const entry = results.find((r) => r.depot === depot && r.mois === m);
      if (entry) {
        entry.etp = Math.max(0, Math.round((entry.etp - leaveFte) * 10) / 10);
      }
    }
  }

  return results;
}

export async function getTargetScenarios() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("wp_target_scenarios")
    .select("*")
    .order("created_at", { ascending: false });
  return data || [];
}
