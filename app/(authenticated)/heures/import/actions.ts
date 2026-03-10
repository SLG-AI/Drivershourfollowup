"use server";

import { createClient } from "@/lib/supabase/server";
import { getPeriodLabel, PERIODS } from "@/lib/constants";
import type { ParsedDriverRow } from "@/lib/utils/excel-parser";

interface SheetImportInput {
  data: ParsedDriverRow[];
  periodNumber: number;
  year: number;
}

interface ImportInput {
  sheets: SheetImportInput[];
  fileName: string;
}

interface SheetImportResult {
  periodLabel: string;
  driversCount: number;
  recordsCount: number;
}

export async function importData(input: ImportInput) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");

  const results: SheetImportResult[] = [];

  for (const sheetInput of input.sheets) {
    const period = PERIODS.find((p) => p.number === sheetInput.periodNumber);
    if (!period) throw new Error(`Période invalide: P${sheetInput.periodNumber}`);

    // 1. Upsert reference period
    const { data: refPeriod, error: periodError } = await supabase
      .from("reference_periods")
      .upsert(
        {
          year: sheetInput.year,
          period_number: sheetInput.periodNumber,
          label: getPeriodLabel(sheetInput.periodNumber, sheetInput.year),
          start_month: period.startMonth,
          end_month: period.endMonth,
        },
        { onConflict: "year,period_number" }
      )
      .select("id")
      .single();

    if (periodError) throw new Error("Erreur lors de la création de la période: " + periodError.message);

    // 2. Create import record
    const { data: importRecord, error: importError } = await supabase
      .from("imports")
      .insert({
        file_name: input.fileName,
        period_id: refPeriod.id,
        imported_by: user.id,
        status: "processing",
        row_count: 0,
      })
      .select("id")
      .single();

    if (importError) throw new Error("Erreur lors de la création de l'import: " + importError.message);

    try {
      // 3. Delete existing monthly records for this period
      await supabase
        .from("monthly_records")
        .delete()
        .eq("period_id", refPeriod.id);

      // 4. Upsert drivers and collect IDs
      const driverMap = new Map<string, string>();

      // Deduplicate drivers by code_salarie (keep last occurrence)
      const uniqueDrivers = new Map<string, ParsedDriverRow>();
      for (const d of sheetInput.data) {
        uniqueDrivers.set(d.codeSalarie, d);
      }
      const deduplicatedDrivers = Array.from(uniqueDrivers.values());

      const driverBatches = [];
      for (let i = 0; i < deduplicatedDrivers.length; i += 100) {
        driverBatches.push(deduplicatedDrivers.slice(i, i + 100));
      }

      for (const batch of driverBatches) {
        const driverRows = batch.map((d) => ({
          code_salarie: d.codeSalarie,
          vehicle_type: d.vehicleType,
          updated_at: new Date().toISOString(),
        }));

        const { data: drivers, error: driverError } = await supabase
          .from("drivers")
          .upsert(driverRows, { onConflict: "code_salarie" })
          .select("id, code_salarie");

        if (driverError) throw new Error("Erreur lors de l'insertion des chauffeurs: " + driverError.message);
        drivers?.forEach((d) => driverMap.set(d.code_salarie, d.id));
      }

      // 5. Insert monthly records in batches
      const allRecords: {
        driver_id: string;
        period_id: string;
        import_id: string;
        month: number;
        year: number;
        buffer_hours: number;
        positive_hours: number;
        missing_hours: number;
        overtime_pay: number;
        counter_end: number;
      }[] = [];

      // Use deduplicated drivers to avoid duplicate monthly records
      const recordMap = new Map<string, typeof allRecords[number]>();
      for (const driver of deduplicatedDrivers) {
        const driverId = driverMap.get(driver.codeSalarie);
        if (!driverId) continue;

        for (const m of driver.months) {
          const key = `${driverId}_${refPeriod.id}_${m.month}_${m.year}`;
          recordMap.set(key, {
            driver_id: driverId,
            period_id: refPeriod.id,
            import_id: importRecord.id,
            month: m.month,
            year: m.year,
            buffer_hours: driver.bufferHours,
            positive_hours: m.positiveHours,
            missing_hours: m.missingHours,
            overtime_pay: m.overtimePay,
            counter_end: m.counterEnd,
          });
        }
      }
      allRecords.push(...recordMap.values());

      for (let i = 0; i < allRecords.length; i += 500) {
        const batch = allRecords.slice(i, i + 500);
        const { error: recordError } = await supabase
          .from("monthly_records")
          .upsert(batch, { onConflict: "driver_id,period_id,month,year" });
        if (recordError) throw new Error("Erreur lors de l'insertion des données mensuelles: " + recordError.message);
      }

      // 6. Update import status
      await supabase
        .from("imports")
        .update({ status: "completed", row_count: sheetInput.data.length })
        .eq("id", importRecord.id);

      results.push({
        periodLabel: getPeriodLabel(sheetInput.periodNumber, sheetInput.year),
        driversCount: sheetInput.data.length,
        recordsCount: allRecords.length,
      });
    } catch (error) {
      await supabase
        .from("imports")
        .update({
          status: "failed",
          error_message: error instanceof Error ? error.message : "Erreur inconnue",
        })
        .eq("id", importRecord.id);

      throw error;
    }
  }

  return {
    success: true,
    results,
    totalDrivers: results.reduce((s, r) => s + r.driversCount, 0),
    totalRecords: results.reduce((s, r) => s + r.recordsCount, 0),
  };
}
