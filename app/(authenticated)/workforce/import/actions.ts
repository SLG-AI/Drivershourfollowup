"use server";

import { createClient } from "@/lib/supabase/server";
import type { WpFileType } from "@/lib/utils/wp-excel-parser";

interface WpImportInput {
  fileType: WpFileType;
  fileName: string;
  data: Record<string, unknown>[];
  mois?: number;
  annee?: number;
}

export async function importWpData(input: WpImportInput) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");

  // Create import record
  const { data: importRecord, error: importError } = await supabase
    .from("wp_imports")
    .insert({
      file_name: input.fileName,
      file_type: input.fileType,
      mois: input.mois || null,
      annee: input.annee || null,
      imported_by: user.id,
      status: "processing",
      row_count: 0,
    })
    .select("id")
    .single();

  if (importError) throw new Error("Erreur création import: " + importError.message);

  try {
    const importId = importRecord.id;

    switch (input.fileType) {
      case "roster_rh":
        await importRosterRH(supabase, input.data, importId);
        break;
      case "salary_stats":
        await importSalaryStats(supabase, input.data, importId);
        break;
      case "absences_cns":
        await importAbsencesCNS(supabase, input.data, importId, input.annee || new Date().getFullYear());
        break;
    }

    // Update import status
    await supabase
      .from("wp_imports")
      .update({ status: "completed", row_count: input.data.length })
      .eq("id", importId);

    return { success: true, rowCount: input.data.length };
  } catch (error) {
    await supabase
      .from("wp_imports")
      .update({
        status: "failed",
        error_message: error instanceof Error ? error.message : "Erreur inconnue",
      })
      .eq("id", importRecord.id);

    throw error;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function importRosterRH(supabase: any, data: Record<string, unknown>[], importId: string) {
  // Delete previous roster data (full replace)
  await supabase
    .from("wp_employees")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");

  // Insert in batches of 200
  for (let i = 0; i < data.length; i += 200) {
    const batch = data.slice(i, i + 200).map((row) => ({
      ...row,
      import_id: importId,
    }));

    const { error } = await supabase.from("wp_employees").insert(batch);
    if (error) throw new Error(`Erreur insertion roster (batch ${Math.floor(i / 200) + 1}): ${error.message}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function importSalaryStats(supabase: any, data: Record<string, unknown>[], importId: string) {
  if (data.length === 0) return;

  // Delete existing data for the same month/year
  const mois = data[0].mois as number;
  const annee = data[0].annee as number;
  if (mois && annee) {
    await supabase
      .from("wp_salary_stats")
      .delete()
      .eq("mois", mois)
      .eq("annee", annee);
  }

  for (let i = 0; i < data.length; i += 200) {
    const batch = data.slice(i, i + 200).map((row) => ({
      ...row,
      import_id: importId,
    }));

    const { error } = await supabase.from("wp_salary_stats").insert(batch);
    if (error) throw new Error(`Erreur insertion stats salariales (batch ${Math.floor(i / 200) + 1}): ${error.message}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function importAbsencesCNS(supabase: any, data: Record<string, unknown>[], importId: string, annee: number) {
  if (data.length === 0) return;

  const mois = data[0].mois as number;

  // Delete existing data for the same month/year
  if (mois && annee) {
    await supabase
      .from("wp_absences")
      .delete()
      .eq("mois", mois)
      .eq("annee", annee);
  }

  // Set annee on all rows, filter out rows with invalid mois (must be 1-12)
  const enrichedData = data
    .map((row) => ({
      ...row,
      annee,
      import_id: importId,
    }))
    .filter((row) => {
      const m = Number((row as Record<string, unknown>).mois);
      return m >= 1 && m <= 12;
    });

  for (let i = 0; i < enrichedData.length; i += 200) {
    const batch = enrichedData.slice(i, i + 200);

    const { error } = await supabase.from("wp_absences").insert(batch);
    if (error) throw new Error(`Erreur insertion absences (batch ${Math.floor(i / 200) + 1}): ${error.message}`);
  }
}

export async function getWpImportHistory() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("wp_imports")
    .select("*")
    .order("imported_at", { ascending: false })
    .limit(20);
  return data || [];
}
