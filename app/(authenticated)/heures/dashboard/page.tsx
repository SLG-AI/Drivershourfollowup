import { createClient } from "@/lib/supabase/server";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { CounterDistributionChart } from "@/components/dashboard/counter-distribution-chart";
import { OvertimePayList } from "@/components/dashboard/overtime-pay-list";

interface Props {
  searchParams: Promise<{ period?: string; vehicle?: string }>;
}

export default async function DashboardPage({ searchParams }: Props) {
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
        <div>
          <h1 className="text-2xl font-bold">Tableau de bord</h1>
          <p className="text-muted-foreground">Vue d&apos;ensemble des heures excédentaires</p>
        </div>
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

  // Fetch dashboard stats
  const { data: stats } = await supabase.rpc("get_dashboard_stats", {
    p_period_ids: periodIds,
    p_vehicle_type: vehicleType,
  });

  // Fetch counter distribution
  const { data: distribution } = await supabase.rpc("get_counter_distribution", {
    p_period_ids: periodIds,
    p_vehicle_type: vehicleType,
  });

  // Fetch drivers with overtime pay (aggregate across selected periods)
  let overtimeQuery = supabase
    .from("driver_period_summary")
    .select("driver_id, code_salarie, vehicle_type, total_overtime_pay, latest_counter")
    .in("period_id", periodIds)
    .gt("total_overtime_pay", 0);

  if (vehicleType) {
    overtimeQuery = overtimeQuery.eq("vehicle_type", vehicleType);
  }

  const { data: rawOvertimeDrivers } = await overtimeQuery;

  // Group by driver and sum overtime pay
  const overtimeMap = new Map<string, { driver_id: string; code_salarie: string; vehicle_type: string; total_overtime_pay: number; latest_counter: number }>();
  (rawOvertimeDrivers || []).forEach((d) => {
    const existing = overtimeMap.get(d.driver_id);
    if (existing) {
      existing.total_overtime_pay += Number(d.total_overtime_pay);
    } else {
      overtimeMap.set(d.driver_id, {
        driver_id: d.driver_id,
        code_salarie: d.code_salarie,
        vehicle_type: d.vehicle_type,
        total_overtime_pay: Number(d.total_overtime_pay),
        latest_counter: Number(d.latest_counter),
      });
    }
  });
  const overtimeDrivers = [...overtimeMap.values()]
    .sort((a, b) => b.total_overtime_pay - a.total_overtime_pay)
    .slice(0, 20);

  const defaultStats = {
    total_drivers: 0,
    bus_count: 0,
    cam_count: 0,
    drivers_with_overtime: 0,
    total_overtime_pay: 0,
    critical_count: 0,
    negative_count: 0,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Tableau de bord</h1>
        <p className="text-muted-foreground">Vue d&apos;ensemble des heures excédentaires</p>
      </div>

      <KpiCards stats={stats || defaultStats} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CounterDistributionChart data={distribution || []} />
        <OvertimePayList drivers={overtimeDrivers || []} />
      </div>
    </div>
  );
}
