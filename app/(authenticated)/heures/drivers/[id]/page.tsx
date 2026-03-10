import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { DriverStatusBadge } from "@/components/drivers/driver-status-badge";
import { CounterEvolutionChart } from "@/components/driver-detail/counter-evolution-chart";
import { PeriodComparisonChart } from "@/components/driver-detail/period-comparison-chart";
import { BackButton } from "@/components/driver-detail/back-button";
import { FRENCH_MONTHS } from "@/lib/constants";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ period?: string }>;
}

export default async function DriverDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();

  // Fetch driver
  const { data: driver } = await supabase
    .from("drivers")
    .select("*")
    .eq("id", id)
    .single();

  if (!driver) notFound();

  // Get period (use first if multi-select, or latest)
  const periodParam = sp.period || "";
  let periodId = periodParam.split(",")[0] || "";
  if (!periodId) {
    const { data: latestPeriod } = await supabase
      .from("reference_periods")
      .select("id")
      .order("year", { ascending: false })
      .order("period_number", { ascending: false })
      .limit(1)
      .single();
    periodId = latestPeriod?.id || "";
  }

  // Fetch all periods for navigation
  const { data: periods } = await supabase
    .from("reference_periods")
    .select("*")
    .order("year", { ascending: false })
    .order("period_number", { ascending: false });

  // Fetch monthly records for selected period
  const { data: records } = await supabase
    .from("monthly_records")
    .select("*")
    .eq("driver_id", id)
    .eq("period_id", periodId || "")
    .order("year")
    .order("month");

  // Fetch driver_period_summary for all periods (for the comparison chart)
  const { data: periodSummaries } = await supabase
    .from("driver_period_summary")
    .select("period_id, total_overtime_pay, latest_counter, total_positive_hours, total_missing_hours")
    .eq("driver_id", id);

  const periodComparisonData = (periods || [])
    .filter((p) => periodSummaries?.some((s) => s.period_id === p.id))
    .sort((a, b) => a.year - b.year || a.period_number - b.period_number)
    .map((p) => {
      const summary = periodSummaries?.find((s) => s.period_id === p.id);
      const counter = Number(summary?.latest_counter || 0);
      return {
        periodLabel: p.label,
        overtimePay: Number(summary?.total_overtime_pay || 0),
        positiveEnd: counter > 0 ? counter : 0,
        missingEnd: counter < 0 ? counter : 0,
      };
    });

  const currentPeriod = periods?.find((p) => p.id === periodId);
  const bufferHours = records?.[0]?.buffer_hours ? Number(records[0].buffer_hours) : 17;
  const latestCounter = records?.length
    ? Number(records[records.length - 1].counter_end)
    : 0;
  const totalOvertimePay = records?.reduce((sum, r) => sum + Number(r.overtime_pay), 0) || 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <BackButton />
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{driver.code_salarie}</h1>
            <Badge variant="outline">{driver.vehicle_type}</Badge>
            <DriverStatusBadge
              counterEnd={latestCounter}
              bufferHours={bufferHours}
              hasOvertimePay={totalOvertimePay > 0}
            />
          </div>
          <p className="text-muted-foreground">
            Buffer: {bufferHours}h — Période: {currentPeriod?.label || "Non sélectionnée"}
          </p>
        </div>
      </div>

      {/* Period navigation */}
      {periods && periods.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {periods.map((p) => (
            <Button
              key={p.id}
              variant={p.id === periodId ? "default" : "outline"}
              size="sm"
              asChild
            >
              <Link href={`/heures/drivers/${id}?period=${p.id}`}>{p.label}</Link>
            </Button>
          ))}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Compteur actuel</p>
            <p className="text-2xl font-bold">{latestCounter.toFixed(2)}h</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total heures sup.</p>
            <p className={`text-2xl font-bold ${totalOvertimePay > 0 ? "text-red-600" : ""}`}>
              {totalOvertimePay.toFixed(2)}h
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Mois enregistrés</p>
            <p className="text-2xl font-bold">{records?.length || 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Period comparison chart */}
      <PeriodComparisonChart data={periodComparisonData} />

      {/* Chart */}
      <CounterEvolutionChart
        records={(records || []).map((r) => ({
          month: r.month,
          year: r.year,
          counter_end: Number(r.counter_end),
          positive_hours: Number(r.positive_hours),
          missing_hours: Number(r.missing_hours),
          overtime_pay: Number(r.overtime_pay),
        }))}
        bufferHours={bufferHours}
      />

      {/* Monthly breakdown table */}
      <Card>
        <CardHeader>
          <CardTitle>Détail mensuel</CardTitle>
        </CardHeader>
        <CardContent>
          {!records || records.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground">
              Aucune donnée pour cette période
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mois</TableHead>
                  <TableHead className="text-right">Heures pos.</TableHead>
                  <TableHead className="text-right">Heures manq.</TableHead>
                  <TableHead className="text-right">Montant à payer</TableHead>
                  <TableHead className="text-right">Compteur fin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {FRENCH_MONTHS[r.month]} {r.year}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {Number(r.positive_hours) > 0 ? (
                        <span className="text-emerald-600">
                          +{Number(r.positive_hours).toFixed(2)}h
                        </span>
                      ) : (
                        "0,00h"
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {Number(r.missing_hours) > 0 ? (
                        <span className="text-blue-600">
                          -{Number(r.missing_hours).toFixed(2)}h
                        </span>
                      ) : (
                        "0,00h"
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {Number(r.overtime_pay) > 0 ? (
                        <span className="text-red-600 font-medium">
                          {Number(r.overtime_pay).toFixed(2)}h
                        </span>
                      ) : (
                        "0,00h"
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium">
                      {Number(r.counter_end).toFixed(2)}h
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
