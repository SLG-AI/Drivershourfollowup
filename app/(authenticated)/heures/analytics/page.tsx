import { createClient } from "@/lib/supabase/server";
import { Suspense } from "react";
import AnalyticsClient from "./analytics-client";
import { FRENCH_MONTHS_SHORT, PERIODS } from "@/lib/constants";

interface Props {
  searchParams: Promise<{ period?: string; vehicle?: string }>;
}

// Helper: paginated fetch to work around Supabase 1000-row default cap
async function fetchAllPages<T>(
  queryFn: (from: number, to: number) => Promise<{ data: T[] | null }>,
  pageSize = 1000
): Promise<T[]> {
  const results: T[] = [];
  let from = 0;
  while (true) {
    const { data } = await queryFn(from, from + pageSize - 1);
    if (!data || data.length === 0) break;
    results.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return results;
}

export default async function AnalyticsPage({ searchParams }: Props) {
  const params = await searchParams;
  const supabase = await createClient();

  // Parse period IDs (comma-separated) or fetch all
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
          <h1 className="text-2xl font-bold">Analytique</h1>
          <p className="text-muted-foreground">
            Graphiques et tendances des heures excédentaires
          </p>
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

  const vehicleType =
    params.vehicle === "BUS" || params.vehicle === "CAM"
      ? params.vehicle
      : null;

  // Run all independent data fetches in parallel
  const [distData, monthlyData, selectedPeriods, comparisonRaw] = await Promise.all([
    // 1. Counter distribution
    fetchAllPages<{ driver_id: string; code_salarie: string; vehicle_type: string; latest_counter: number; total_overtime_pay: number }>(
      (from, to) => {
        let q = supabase
          .from("driver_period_summary")
          .select("driver_id, code_salarie, vehicle_type, latest_counter, total_overtime_pay")
          .in("period_id", periodIds)
          .range(from, to);
        if (vehicleType) q = q.eq("vehicle_type", vehicleType);
        return q as unknown as Promise<{ data: { driver_id: string; code_salarie: string; vehicle_type: string; latest_counter: number; total_overtime_pay: number }[] | null }>;
      }
    ),
    // 2. Monthly records (aggregated server-side via RPC)
    supabase.rpc("get_monthly_aggregation", {
      p_period_ids: periodIds,
      p_vehicle_type: vehicleType,
    }).then((r) => r.data as { month: number; year: number; sum_counter_end: number; sum_overtime_pay: number; sum_missing_hours: number; sum_positive_hours: number; count_drivers: number }[] | null),
    // 3. Selected periods for month slots
    supabase
      .from("reference_periods")
      .select("year, period_number")
      .in("id", periodIds)
      .order("year")
      .order("period_number")
      .then((r) => r.data),
    // 4. Period comparison RPC
    supabase.rpc("get_period_comparison", {
      p_period_ids: periodIds,
      p_vehicle_type: vehicleType,
    }).then((r) => r.data),
  ]);

  // === Process distData: group by driver and compute aggregates ===
  const driverAvgMap = new Map<
    string,
    {
      driverId: string;
      codeSalarie: string;
      vehicleType: string;
      counterValues: number[];
      totalMissing: number;
      totalExcess: number;
    }
  >();
  distData.forEach((d) => {
    const counter = Number(d.latest_counter);
    const overtimePay = Number(d.total_overtime_pay);
    const missing = counter < 0 ? counter : 0;
    const excess = Math.max(0, counter) + overtimePay;

    const existing = driverAvgMap.get(d.driver_id);
    if (existing) {
      existing.counterValues.push(counter);
      existing.totalMissing += missing;
      existing.totalExcess += excess;
    } else {
      driverAvgMap.set(d.driver_id, {
        driverId: d.driver_id,
        codeSalarie: d.code_salarie,
        vehicleType: d.vehicle_type,
        counterValues: [counter],
        totalMissing: missing,
        totalExcess: excess,
      });
    }
  });

  const BUCKET_ORDER = ["< -10h", "-10h à 0h", "0h à 5h", "5h à 10h", "10h à 15h", "> 15h"];
  const BUCKET_RANGES: Record<string, { min: number; max: number }> = {
    "< -10h": { min: -Infinity, max: -10 },
    "-10h à 0h": { min: -10, max: 0 },
    "0h à 5h": { min: 0, max: 5 },
    "5h à 10h": { min: 5, max: 10 },
    "10h à 15h": { min: 10, max: 15 },
    "> 15h": { min: 15, max: Infinity },
  };

  function getBucket(value: number): string {
    for (const bucket of BUCKET_ORDER) {
      const range = BUCKET_RANGES[bucket];
      if (
        (range.min === -Infinity || value >= range.min) &&
        (range.max === Infinity || value < range.max)
      ) {
        return bucket;
      }
    }
    return "> 15h";
  }

  const driverAverages: {
    driverId: string;
    codeSalarie: string;
    vehicleType: string;
    avgCounter: number;
    totalMissing: number;
    totalExcess: number;
  }[] = [];
  const bucketCounts = new Map<string, number>();
  BUCKET_ORDER.forEach((b) => bucketCounts.set(b, 0));

  driverAvgMap.forEach((d) => {
    const avg =
      d.counterValues.reduce((a, b) => a + b, 0) / d.counterValues.length;
    driverAverages.push({
      driverId: d.driverId,
      codeSalarie: d.codeSalarie,
      vehicleType: d.vehicleType,
      avgCounter: avg,
      totalMissing: d.totalMissing,
      totalExcess: d.totalExcess,
    });
    const bucket = getBucket(avg);
    bucketCounts.set(bucket, (bucketCounts.get(bucket) || 0) + 1);
  });

  const distribution = BUCKET_ORDER
    .map((bucket) => ({ bucket, count: bucketCounts.get(bucket) || 0 }))
    .filter((d) => d.count > 0);

  // === Process monthlyData: build month slots and aggregate ===
  const allMonthSlots: { year: number; month: number; key: string }[] = [];
  for (const sp of selectedPeriods || []) {
    const periodDef = PERIODS.find((p) => p.number === sp.period_number);
    if (!periodDef) continue;
    for (const m of periodDef.months) {
      const key = `${sp.year}-${String(m).padStart(2, "0")}`;
      if (!allMonthSlots.some((s) => s.key === key)) {
        allMonthSlots.push({ year: sp.year, month: m, key });
      }
    }
  }
  allMonthSlots.sort((a, b) => a.key.localeCompare(b.key));

  // Index RPC results by year-month key
  const PERIOD_END_MONTHS = new Set<number>(PERIODS.map((p) => p.endMonth));
  const monthlyMap = new Map<string, { sumCounterEnd: number; sumOvertimePay: number; sumMissingHours: number; sumPositiveHours: number; countDrivers: number }>();
  (monthlyData || []).forEach((r) => {
    const key = `${r.year}-${String(r.month).padStart(2, "0")}`;
    monthlyMap.set(key, {
      sumCounterEnd: Number(r.sum_counter_end),
      sumOvertimePay: Number(r.sum_overtime_pay),
      sumMissingHours: Number(r.sum_missing_hours),
      sumPositiveHours: Number(r.sum_positive_hours),
      countDrivers: Number(r.count_drivers),
    });
  });

  const monthlyAvg = allMonthSlots.map(({ month, year, key }) => {
    const data = monthlyMap.get(key);
    const totalOvertimePay = data?.sumOvertimePay || 0;
    const totalMissingHours = data?.sumMissingHours || 0;
    const sumCounterEnd = data?.sumCounterEnd || 0;
    const countDrivers = data?.countDrivers || 0;
    const isPeriodEnd = PERIOD_END_MONTHS.has(month);
    // For period-end months, positive/negative counters are approximated from the sum
    const positiveCounters = isPeriodEnd ? Math.max(0, sumCounterEnd) : 0;
    const negativeCounters = isPeriodEnd ? Math.abs(Math.min(0, sumCounterEnd)) : 0;
    return {
      name: `${FRENCH_MONTHS_SHORT[month]} ${year}`,
      moyenne: countDrivers > 0 ? sumCounterEnd / countDrivers : 0,
      heuresPayees: totalOvertimePay + positiveCounters,
      heuresManquantes: totalMissingHours + negativeCounters,
    };
  });

  const monthlyHours = allMonthSlots.map(({ month, year, key }) => {
    const data = monthlyMap.get(key);
    return {
      name: `${FRENCH_MONTHS_SHORT[month]} ${year}`,
      heuresPositives: data?.sumPositiveHours || 0,
      heuresNegatives: data?.sumMissingHours || 0,
      driverCount: data?.countDrivers || 0,
    };
  });

  // === Process period comparison ===
  const periodComparison = (comparisonRaw || []).map(
    (d: Record<string, unknown>) => ({
      periodId: String(d.period_id),
      periodLabel: String(d.period_label),
      year: Number(d.year),
      periodNumber: Number(d.period_number),
      totalDrivers: Number(d.total_drivers),
      totalOvertimePay: Number(d.total_overtime_pay),
      totalPositiveEnd: Number(d.total_positive_end),
      driversPositive: Number(d.drivers_positive),
      totalMissingEnd: Number(d.total_missing_end),
      driversNegative: Number(d.drivers_negative),
    })
  );

  // === Status breakdown based on 10% extremes ===
  const totalDriverCount = driverAverages.length;
  const topN = Math.max(1, Math.ceil(totalDriverCount * 0.1));

  const sortedByMissing = [...driverAverages]
    .filter((d) => d.totalMissing < 0)
    .sort((a, b) => a.totalMissing - b.totalMissing);
  const criticalMissingIds = new Set(
    sortedByMissing.slice(0, topN).map((d) => d.driverId)
  );

  const sortedByExcess = [...driverAverages]
    .filter((d) => d.totalExcess > 0)
    .sort((a, b) => b.totalExcess - a.totalExcess);
  const criticalExcessIds = new Set(
    sortedByExcess.slice(0, topN).map((d) => d.driverId)
  );

  let criticalCount = 0;
  let normalCount = 0;
  driverAverages.forEach((d) => {
    if (criticalMissingIds.has(d.driverId) || criticalExcessIds.has(d.driverId)) {
      criticalCount++;
    } else {
      normalCount++;
    }
  });

  const criticalAllIds = new Set([...criticalMissingIds, ...criticalExcessIds]);

  const statusBreakdown = [
    ...(normalCount > 0
      ? [{ name: "Normal", value: normalCount, fill: "#22c55e" }]
      : []),
    ...(criticalCount > 0
      ? [{ name: "Critique", value: criticalCount, fill: "#ef4444" }]
      : []),
  ];

  return (
    <Suspense
      fallback={
        <div className="py-12 text-center text-muted-foreground">
          Chargement...
        </div>
      }
    >
      <AnalyticsClient
        distribution={distribution}
        driverAverages={driverAverages}
        criticalDriverIds={Array.from(criticalAllIds)}
        monthlyAvg={monthlyAvg}
        monthlyHours={monthlyHours}
        periodComparison={periodComparison}
        statusBreakdown={statusBreakdown}
      />
    </Suspense>
  );
}
