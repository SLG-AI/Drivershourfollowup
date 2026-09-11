"use server";

import { createClient } from "@/lib/supabase/server";
import type { WpFileType } from "@/lib/utils/wp-excel-parser";
import { preparerStatsSalariales } from "@/lib/utils/wp-salary-import";

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
    let rowCount = input.data.length;

    switch (input.fileType) {
      case "roster_rh":
        await importRosterRH(supabase, input.data, importId, input.mois, input.annee);
        break;
      case "salary_stats":
        rowCount = await importSalaryStats(supabase, input.data, importId, input.mois, input.annee);
        break;
      case "absences_cns":
        await importAbsencesCNS(supabase, input.data, importId, input.annee || new Date().getFullYear());
        break;
      case "absences_mct":
        await importAbsencesMCT(supabase, input.data, importId, input.mois, input.annee || new Date().getFullYear());
        break;
      case "absences_injustifiees":
        await importAbsencesInjustifiees(supabase, input.data, importId);
        break;
      case "mouvements":
        await importMouvements(supabase, input.data, importId);
        break;
    }

    // Update import status
    await supabase
      .from("wp_imports")
      .update({ status: "completed", row_count: rowCount })
      .eq("id", importId);

    return { success: true, rowCount };
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
async function importRosterRH(supabase: any, data: Record<string, unknown>[], importId: string, mois?: number, annee?: number) {
  // Le roster est historisé : un import ne remplace QUE sa propre période.
  // Sans période, on effacerait un mois au hasard — on refuse plutôt.
  if (!mois || !annee) {
    throw new Error("Mois et année requis pour un import de roster : chaque import est une photographie d'effectif datée.");
  }

  await supabase
    .from("wp_employees")
    .delete()
    .eq("mois", mois)
    .eq("annee", annee);

  // Insert in batches of 200
  for (let i = 0; i < data.length; i += 200) {
    const batch = data.slice(i, i + 200).map((row) => ({
      ...row,
      mois,
      annee,
      import_id: importId,
    }));

    const { error } = await supabase.from("wp_employees").insert(batch);
    if (error) throw new Error(`Erreur insertion roster (batch ${Math.floor(i / 200) + 1}): ${error.message}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function importSalaryStats(supabase: any, data: Record<string, unknown>[], importId: string, mois?: number, annee?: number): Promise<number> {
  if (data.length === 0) return 0;

  // Le mois/année choisis à l'écran servent de repli aux lignes sans période
  // valide ; celles qui en restent dépourvues sont écartées plutôt que de
  // faire échouer tout l'import sur la contrainte mois BETWEEN 1 AND 12.
  const { lignes, periode } = preparerStatsSalariales(data, importId, mois, annee);
  if (lignes.length === 0 || !periode) return 0;

  // Delete existing data for the same month/year
  await supabase
    .from("wp_salary_stats")
    .delete()
    .eq("mois", periode.mois)
    .eq("annee", periode.annee);

  for (let i = 0; i < lignes.length; i += 200) {
    const batch = lignes.slice(i, i + 200);

    const { error } = await supabase.from("wp_salary_stats").insert(batch);
    if (error) throw new Error(`Erreur insertion stats salariales (batch ${Math.floor(i / 200) + 1}): ${error.message}`);
  }

  return lignes.length;
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function importAbsencesMCT(supabase: any, data: Record<string, unknown>[], importId: string, mois?: number, annee?: number) {
  if (data.length === 0) return;

  const targetMois = mois || (data[0].mois as number);
  const targetAnnee = annee || (data[0].annee as number);

  // Delete existing data for the same month/year
  if (targetMois && targetAnnee) {
    await supabase
      .from("wp_absences_mct")
      .delete()
      .eq("mois", targetMois)
      .eq("annee", targetAnnee);
  }

  for (let i = 0; i < data.length; i += 200) {
    const batch = data.slice(i, i + 200).map((row) => ({
      ...row,
      import_id: importId,
    }));

    const { error } = await supabase.from("wp_absences_mct").insert(batch);
    if (error) throw new Error(`Erreur insertion absences MCT (batch ${Math.floor(i / 200) + 1}): ${error.message}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function importAbsencesInjustifiees(supabase: any, data: Record<string, unknown>[], importId: string) {
  if (data.length === 0) return;

  // Delete all existing data (full replace — multi-year file)
  await supabase
    .from("wp_absences_injustifiees")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");

  for (let i = 0; i < data.length; i += 200) {
    const batch = data.slice(i, i + 200).map((row) => ({
      ...row,
      import_id: importId,
    }));

    const { error } = await supabase.from("wp_absences_injustifiees").insert(batch);
    if (error) throw new Error(`Erreur insertion absences injustifiées (batch ${Math.floor(i / 200) + 1}): ${error.message}`);
  }
}

// Mouvements SIRH : chaque ligne porte sa période (mois de la date du
// mouvement) ; l'import remplace les périodes présentes dans le fichier, et
// elles seules, pour pouvoir charger un export mensuel comme un export annuel.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function importMouvements(supabase: any, data: Record<string, unknown>[], importId: string) {
  if (data.length === 0) return;

  const periodes = new Map<string, { mois: number; annee: number }>();
  data.forEach((r) => {
    const mois = Number(r.mois);
    const annee = Number(r.annee);
    periodes.set(`${annee}-${mois}`, { mois, annee });
  });
  for (const p of periodes.values()) {
    const { error } = await supabase.from("wp_mouvements").delete().eq("mois", p.mois).eq("annee", p.annee);
    if (error) throw new Error(`Erreur remplacement des mouvements ${p.mois}/${p.annee}: ${error.message}`);
  }

  for (let i = 0; i < data.length; i += 200) {
    const batch = data.slice(i, i + 200).map((row) => ({ ...row, import_id: importId }));
    const { error } = await supabase.from("wp_mouvements").insert(batch);
    if (error) throw new Error(`Erreur insertion mouvements (batch ${Math.floor(i / 200) + 1}): ${error.message}`);
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
