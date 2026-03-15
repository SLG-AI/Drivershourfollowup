"use server";

import { createClient } from "@/lib/supabase/server";

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

  // Clear all existing targets and re-insert
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

export async function getTargets() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("wp_target_needs")
    .select("*")
    .order("vehicle_type")
    .order("depot")
    .order("work_time");
  return data || [];
}

export async function getDepots() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("wp_employees")
    .select("description_departement")
    .not("description_departement", "is", null)
    .not("description_departement", "eq", "");

  if (!data) return [];

  const unique = [...new Set(data.map((d) => d.description_departement as string))].sort();
  return unique;
}
