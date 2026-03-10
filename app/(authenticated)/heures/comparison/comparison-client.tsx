"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FRENCH_MONTHS_SHORT } from "@/lib/constants";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Plus, X } from "lucide-react";

const COLORS = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6"];

interface Driver {
  id: string;
  code_salarie: string;
  vehicle_type: string;
}

interface MonthlyRecord {
  month: number;
  year: number;
  positive_hours: number;
  missing_hours: number;
  overtime_pay: number;
  counter_end: number;
}

interface DriverWithRecords {
  driver: Driver;
  records: MonthlyRecord[];
}

export default function ComparisonPage() {
  const searchParams = useSearchParams();
  const periodParam = searchParams.get("period") || "";
  const periodIds = periodParam ? periodParam.split(",") : [];

  const [allDrivers, setAllDrivers] = useState<Driver[]>([]);
  const [selectedDrivers, setSelectedDrivers] = useState<DriverWithRecords[]>([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    async function fetchDrivers() {
      const supabase = createClient();
      const { data } = await supabase
        .from("drivers")
        .select("id, code_salarie, vehicle_type")
        .order("code_salarie");
      if (data) setAllDrivers(data);
    }
    fetchDrivers();
  }, []);

  const addDriver = useCallback(
    async (driver: Driver) => {
      if (selectedDrivers.length >= 5) return;
      if (selectedDrivers.some((d) => d.driver.id === driver.id)) return;

      const supabase = createClient();
      let query = supabase
        .from("monthly_records")
        .select("month, year, positive_hours, missing_hours, overtime_pay, counter_end")
        .eq("driver_id", driver.id)
        .order("year")
        .order("month");

      if (periodIds.length > 0) query = query.in("period_id", periodIds);

      const { data } = await query;
      setSelectedDrivers((prev) => [
        ...prev,
        {
          driver,
          records: (data || []).map((r) => ({
            ...r,
            positive_hours: Number(r.positive_hours),
            missing_hours: Number(r.missing_hours),
            overtime_pay: Number(r.overtime_pay),
            counter_end: Number(r.counter_end),
          })),
        },
      ]);
      setOpen(false);
      setSearch("");
    },
    [selectedDrivers, periodIds]
  );

  const removeDriver = (id: string) => {
    setSelectedDrivers((prev) => prev.filter((d) => d.driver.id !== id));
  };

  // Build chart data
  const allMonths = new Set<string>();
  selectedDrivers.forEach((d) =>
    d.records.forEach((r) => allMonths.add(`${r.year}-${r.month}`))
  );
  const sortedMonths = Array.from(allMonths).sort();

  const chartData = sortedMonths.map((key) => {
    const [year, month] = key.split("-").map(Number);
    const point: Record<string, unknown> = {
      name: `${FRENCH_MONTHS_SHORT[month]} ${year}`,
    };
    selectedDrivers.forEach((d) => {
      const record = d.records.find((r) => r.month === month && r.year === year);
      point[d.driver.code_salarie] = record?.counter_end ?? null;
    });
    return point;
  });

  const filteredDrivers = allDrivers.filter(
    (d) =>
      d.code_salarie.toLowerCase().includes(search.toLowerCase()) &&
      !selectedDrivers.some((sd) => sd.driver.id === d.id)
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Comparaison</h1>
        <p className="text-muted-foreground">
          Comparez les heures de 2 à 5 conducteurs côte à côte.
        </p>
      </div>

      {/* Driver selector */}
      <Card>
        <CardHeader>
          <CardTitle>Conducteurs sélectionnés</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            {selectedDrivers.map((d, i) => (
              <Badge
                key={d.driver.id}
                variant="secondary"
                className="flex items-center gap-1 px-3 py-1.5"
                style={{ borderLeftColor: COLORS[i], borderLeftWidth: 3 }}
              >
                {d.driver.code_salarie} ({d.driver.vehicle_type})
                <button onClick={() => removeDriver(d.driver.id)}>
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            {selectedDrivers.length < 5 && (
              <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Plus className="mr-1 h-3 w-3" /> Ajouter
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-0" align="start">
                  <Command>
                    <CommandInput
                      placeholder="Rechercher..."
                      value={search}
                      onValueChange={setSearch}
                    />
                    <CommandList>
                      <CommandEmpty>Aucun résultat</CommandEmpty>
                      <CommandGroup>
                        {filteredDrivers.slice(0, 20).map((d) => (
                          <CommandItem
                            key={d.id}
                            onSelect={() => addDriver(d)}
                          >
                            {d.code_salarie} — {d.vehicle_type}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}
          </div>
        </CardContent>
      </Card>

      {selectedDrivers.length >= 2 && (
        <>
          {/* Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Évolution des compteurs</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={350}>
                <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: "8px",
                      border: "1px solid hsl(var(--border))",
                    }}
                  />
                  <Legend />
                  {selectedDrivers.map((d, i) => (
                    <Line
                      key={d.driver.id}
                      type="monotone"
                      dataKey={d.driver.code_salarie}
                      stroke={COLORS[i]}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Comparison table */}
          <Card>
            <CardHeader>
              <CardTitle>Détail comparatif</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mois</TableHead>
                      {selectedDrivers.map((d, i) => (
                        <TableHead key={d.driver.id} colSpan={3} className="text-center">
                          <span style={{ color: COLORS[i] }}>{d.driver.code_salarie}</span>
                        </TableHead>
                      ))}
                    </TableRow>
                    <TableRow>
                      <TableHead />
                      {selectedDrivers.map((d) => (
                        <>
                          <TableHead key={`${d.driver.id}-pos`} className="text-right text-xs">Pos.</TableHead>
                          <TableHead key={`${d.driver.id}-manq`} className="text-right text-xs">Manq.</TableHead>
                          <TableHead key={`${d.driver.id}-cpt`} className="text-right text-xs">Compteur</TableHead>
                        </>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedMonths.map((key) => {
                      const [year, month] = key.split("-").map(Number);
                      return (
                        <TableRow key={key}>
                          <TableCell className="font-medium">
                            {FRENCH_MONTHS_SHORT[month]} {year}
                          </TableCell>
                          {selectedDrivers.map((d) => {
                            const r = d.records.find(
                              (rec) => rec.month === month && rec.year === year
                            );
                            return (
                              <>
                                <TableCell key={`${d.driver.id}-${key}-pos`} className="text-right font-mono text-xs">
                                  {r ? r.positive_hours.toFixed(1) : "-"}
                                </TableCell>
                                <TableCell key={`${d.driver.id}-${key}-manq`} className="text-right font-mono text-xs">
                                  {r ? r.missing_hours.toFixed(1) : "-"}
                                </TableCell>
                                <TableCell key={`${d.driver.id}-${key}-cpt`} className="text-right font-mono text-xs font-medium">
                                  {r ? r.counter_end.toFixed(1) : "-"}
                                </TableCell>
                              </>
                            );
                          })}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {selectedDrivers.length > 0 && selectedDrivers.length < 2 && (
        <p className="text-center text-muted-foreground">
          Sélectionnez au moins 2 conducteurs pour comparer.
        </p>
      )}
    </div>
  );
}
