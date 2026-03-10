import { createClient } from "@/lib/supabase/server";
import { DriverListClient } from "./driver-list-client";

interface Props {
  searchParams: Promise<{ period?: string; vehicle?: string }>;
}

export default async function DriversPage({ searchParams }: Props) {
  const params = await searchParams;
  const supabase = await createClient();

  // Parse period IDs (comma-separated) or fetch all, validating against DB
  const { data: allPeriods } = await supabase
    .from("reference_periods")
    .select("id");
  const allPeriodIds = new Set(allPeriods?.map((p) => p.id) || []);

  let periodIds: string[] = [];
  if (params.period) {
    periodIds = params.period.split(",").filter((id) => allPeriodIds.has(id));
  }
  if (periodIds.length === 0) {
    periodIds = [...allPeriodIds];
  }

  if (periodIds.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Conducteurs</h1>
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12">
          <p className="text-lg font-medium">Aucune donnée disponible</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Importez un fichier Excel pour commencer.
          </p>
        </div>
      </div>
    );
  }

  const vehicleType = params.vehicle === "BUS" || params.vehicle === "CAM" ? params.vehicle : null;

  let query = supabase
    .from("driver_period_summary")
    .select("*")
    .in("period_id", periodIds)
    .order("code_salarie");

  if (vehicleType) {
    query = query.eq("vehicle_type", vehicleType);
  }

  const { data: rawDrivers } = await query;

  // Aggregate per driver: single period → value as-is, multiple periods → average counter
  const driverMap = new Map<string, {
    driver_id: string;
    code_salarie: string;
    vehicle_type: string;
    total_positive_hours: number;
    total_missing_hours: number;
    total_overtime_pay: number;
    latest_counter: number;
    buffer_hours: number;
    months_recorded: number;
    period_count: number;
  }>();

  for (const row of rawDrivers || []) {
    const existing = driverMap.get(row.driver_id);
    if (existing) {
      existing.total_positive_hours += Number(row.total_positive_hours);
      existing.total_missing_hours += Number(row.total_missing_hours);
      existing.total_overtime_pay += Number(row.total_overtime_pay);
      existing.latest_counter += Number(row.latest_counter);
      existing.months_recorded += Number(row.months_recorded);
      existing.period_count += 1;
    } else {
      driverMap.set(row.driver_id, {
        driver_id: row.driver_id,
        code_salarie: row.code_salarie,
        vehicle_type: row.vehicle_type,
        total_positive_hours: Number(row.total_positive_hours),
        total_missing_hours: Number(row.total_missing_hours),
        total_overtime_pay: Number(row.total_overtime_pay),
        latest_counter: Number(row.latest_counter),
        buffer_hours: Number(row.buffer_hours),
        months_recorded: Number(row.months_recorded),
        period_count: 1,
      });
    }
  }

  const drivers = Array.from(driverMap.values()).map(({ period_count, ...d }) => ({
    ...d,
    latest_counter: d.latest_counter / period_count,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Conducteurs</h1>
        <p className="text-muted-foreground">
          Liste de tous les conducteurs avec leurs indicateurs
        </p>
      </div>
      <DriverListClient drivers={drivers} />
    </div>
  );
}
