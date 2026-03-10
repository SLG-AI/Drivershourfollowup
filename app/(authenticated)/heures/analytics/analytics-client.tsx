"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, ArrowUp, ArrowDown, X } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LineChart,
  Line,
  PieChart,
  Pie,
  Legend,
} from "recharts";

const BUCKET_RANGES: Record<string, { min: number; max: number }> = {
  "< -10h": { min: -Infinity, max: -10 },
  "-10h à 0h": { min: -10, max: 0 },
  "0h à 5h": { min: 0, max: 5 },
  "5h à 10h": { min: 5, max: 10 },
  "10h à 15h": { min: 10, max: 15 },
  "> 15h": { min: 15, max: Infinity },
};

const BUCKET_COLORS: Record<string, string> = {
  "< -10h": "#6366f1",
  "-10h à 0h": "#3b82f6",
  "0h à 5h": "#22c55e",
  "5h à 10h": "#eab308",
  "10h à 15h": "#f97316",
  "> 15h": "#ef4444",
};

interface DriverAverage {
  driverId: string;
  codeSalarie: string;
  vehicleType: string;
  avgCounter: number;
}

interface PeriodComparison {
  periodId: string;
  periodLabel: string;
  year: number;
  periodNumber: number;
  totalDrivers: number;
  totalOvertimePay: number;
  totalPositiveEnd: number;
  driversPositive: number;
  totalMissingEnd: number;
  driversNegative: number;
}

interface AnalyticsClientProps {
  distribution: { bucket: string; count: number }[];
  driverAverages: DriverAverage[];
  criticalDriverIds: string[];
  monthlyAvg: { name: string; moyenne: number; heuresPayees: number; heuresManquantes: number }[];
  monthlyHours: { name: string; heuresPositives: number; heuresNegatives: number; driverCount: number }[];
  periodComparison: PeriodComparison[];
  statusBreakdown: { name: string; value: number; fill: string }[];
}

export default function AnalyticsClient({
  distribution,
  driverAverages,
  criticalDriverIds,
  monthlyAvg,
  monthlyHours,
  periodComparison,
  statusBreakdown,
}: AnalyticsClientProps) {
  const [visibleMetrics, setVisibleMetrics] = useState<Set<string>>(
    new Set(["Heures payées", "Heures positives fin", "Heures manquantes fin"])
  );
  const [visibleLines, setVisibleLines] = useState<Set<string>>(
    new Set(["Heures payées", "Heures manquantes"])
  );
  const [visibleHoursLines, setVisibleHoursLines] = useState<Set<string>>(
    new Set(["Heures positives", "Heures négatives"])
  );
  const [hoursMode, setHoursMode] = useState<"sum" | "avg">("sum");
  const [comparisonMode, setComparisonMode] = useState<"sum" | "avg">("sum");

  // Bucket drill-down state
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [bucketSortAsc, setBucketSortAsc] = useState(true);

  // Status pie drill-down state
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [statusSortAsc, setStatusSortAsc] = useState(true);

  const handleBucketClick = useCallback(
    (bucket: string) => {
      if (selectedBucket === bucket) {
        setSelectedBucket(null);
      } else {
        setSelectedBucket(bucket);
        setBucketSortAsc(true);
      }
    },
    [selectedBucket]
  );

  // Filter drivers for the selected bucket from pre-computed averages
  const bucketDrivers = selectedBucket
    ? driverAverages.filter((d) => {
        const range = BUCKET_RANGES[selectedBucket];
        if (!range) return false;
        return (
          (range.min === -Infinity || d.avgCounter >= range.min) &&
          (range.max === Infinity || d.avgCounter < range.max)
        );
      })
    : [];

  const sortedBucketDrivers = [...bucketDrivers].sort((a, b) =>
    bucketSortAsc ? a.avgCounter - b.avgCounter : b.avgCounter - a.avgCounter
  );

  // Filter drivers for the selected status from pie chart
  const criticalSet = new Set(criticalDriverIds);
  const statusDrivers = selectedStatus
    ? driverAverages.filter((d) => {
        const isCritical = criticalSet.has(d.driverId);
        return selectedStatus === "Critique" ? isCritical : !isCritical;
      })
    : [];

  const sortedStatusDrivers = [...statusDrivers].sort((a, b) =>
    statusSortAsc ? a.avgCounter - b.avgCounter : b.avgCounter - a.avgCounter
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Analytique</h1>
        <p className="text-muted-foreground">
          Graphiques et tendances des heures excédentaires
        </p>
      </div>

      {/* Period comparison section */}
      {periodComparison.length > 0 && (
        <>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Comparaison par période</CardTitle>
                <div className="flex items-center gap-3">
                  <div className="flex rounded-md border overflow-hidden">
                    <Button
                      size="sm"
                      variant={comparisonMode === "sum" ? "default" : "ghost"}
                      className="text-xs h-7 px-3 rounded-none"
                      onClick={() => setComparisonMode("sum")}
                    >
                      Somme
                    </Button>
                    <Button
                      size="sm"
                      variant={comparisonMode === "avg" ? "default" : "ghost"}
                      className="text-xs h-7 px-3 rounded-none"
                      onClick={() => setComparisonMode("avg")}
                    >
                      Moy/conducteur
                    </Button>
                  </div>
                  <div className="flex gap-1.5">
                    {([
                      { key: "Heures payées", color: "#ef4444", label: "Payées" },
                      { key: "Heures positives fin", color: "#22c55e", label: "Positives" },
                      { key: "Heures manquantes fin", color: "#3b82f6", label: "Manquantes" },
                    ] as const).map(({ key, color, label }) => {
                      const active = visibleMetrics.has(key);
                      return (
                        <Button
                          key={key}
                          size="sm"
                          variant={active ? "default" : "outline"}
                          className="text-xs h-7 px-2.5"
                          style={active ? { backgroundColor: color, borderColor: color } : { color, borderColor: color }}
                          onClick={() => {
                            setVisibleMetrics((prev) => {
                              const next = new Set(prev);
                              if (next.has(key)) {
                                if (next.size > 1) next.delete(key);
                              } else {
                                next.add(key);
                              }
                              return next;
                            });
                          }}
                        >
                          {label}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={350}>
                <BarChart
                  data={periodComparison.map((p) => {
                    const divisor = comparisonMode === "avg" && p.totalDrivers > 0 ? p.totalDrivers : 1;
                    return {
                      name: p.periodLabel,
                      "Heures payées": Number((p.totalOvertimePay / divisor).toFixed(2)),
                      "Heures positives fin": Number((p.totalPositiveEnd / divisor).toFixed(2)),
                      "Heures manquantes fin": Number((p.totalMissingEnd / divisor).toFixed(2)),
                    };
                  })}
                  margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip
                    formatter={(value) => [`${Number(value).toFixed(2)}h`]}
                    contentStyle={{
                      borderRadius: "8px",
                      border: "1px solid hsl(var(--border))",
                    }}
                  />
                  <Legend />
                  {visibleMetrics.has("Heures payées") && (
                    <Bar dataKey="Heures payées" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  )}
                  {visibleMetrics.has("Heures positives fin") && (
                    <Bar dataKey="Heures positives fin" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  )}
                  {visibleMetrics.has("Heures manquantes fin") && (
                    <Bar dataKey="Heures manquantes fin" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  )}
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Détail par période</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Période</TableHead>
                    <TableHead className="text-right">Conducteurs</TableHead>
                    <TableHead className="text-right">Heures payées</TableHead>
                    <TableHead className="text-right">H. positives fin</TableHead>
                    <TableHead className="text-right">H. manquantes fin</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {periodComparison.map((p) => (
                    <TableRow key={p.periodId}>
                      <TableCell className="font-medium">{p.periodLabel}</TableCell>
                      <TableCell className="text-right">{p.totalDrivers}</TableCell>
                      <TableCell className="text-right font-mono">
                        {p.totalOvertimePay > 0 ? (
                          <span className="text-red-600 font-medium">
                            {p.totalOvertimePay.toFixed(2)}h
                          </span>
                        ) : (
                          "0,00h"
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        <span className="text-emerald-600">
                          {p.totalPositiveEnd.toFixed(2)}h
                        </span>
                        <span className="text-muted-foreground text-xs ml-1">
                          ({p.driversPositive})
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        <span className="text-blue-600">
                          {p.totalMissingEnd.toFixed(2)}h
                        </span>
                        <span className="text-muted-foreground text-xs ml-1">
                          ({p.driversNegative})
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Distribution chart */}
        <Card>
          <CardHeader>
            <CardTitle>Distribution des compteurs</CardTitle>
            <p className="text-xs text-muted-foreground">
              Moyenne par conducteur sur les périodes sélectionnées — Cliquez sur une barre pour voir le détail
            </p>
          </CardHeader>
          <CardContent>
            {distribution.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">Aucune donnée</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={distribution}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="bucket" fontSize={11} />
                  <YAxis fontSize={12} />
                  <Tooltip />
                  <Bar
                    dataKey="count"
                    name="Conducteurs"
                    radius={[4, 4, 0, 0]}
                    cursor="pointer"
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    onClick={(data: any) => {
                      if (data?.bucket) handleBucketClick(data.bucket);
                    }}
                  >
                    {distribution.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={BUCKET_COLORS[entry.bucket] || "#6366f1"}
                        opacity={selectedBucket && selectedBucket !== entry.bucket ? 0.3 : 1}
                        stroke={selectedBucket === entry.bucket ? "#000" : "none"}
                        strokeWidth={selectedBucket === entry.bucket ? 2 : 0}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Status pie chart */}
        <Card>
          <CardHeader>
            <CardTitle>Répartition par statut</CardTitle>
            <p className="text-xs text-muted-foreground">
              10% extrêmes = Critique — Cliquez sur une zone pour voir le détail
            </p>
          </CardHeader>
          <CardContent>
            {statusBreakdown.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">Aucune donnée</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={statusBreakdown}
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, value }) => `${name}: ${value}`}
                    cursor="pointer"
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    onClick={(data: any) => {
                      if (data?.name) {
                        setSelectedStatus(
                          selectedStatus === data.name ? null : data.name
                        );
                        setStatusSortAsc(true);
                      }
                    }}
                  >
                    {statusBreakdown.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={entry.fill}
                        opacity={selectedStatus && selectedStatus !== entry.name ? 0.3 : 1}
                        stroke={selectedStatus === entry.name ? "#000" : "none"}
                        strokeWidth={selectedStatus === entry.name ? 2 : 0}
                      />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Status drill-down detail */}
      {selectedStatus && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 rounded-full"
                  style={{
                    backgroundColor:
                      selectedStatus === "Critique" ? "#ef4444" : "#22c55e",
                  }}
                />
                Conducteurs : {selectedStatus}
                <span className="text-muted-foreground font-normal text-sm">
                  ({statusDrivers.length})
                </span>
              </CardTitle>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setStatusSortAsc((prev) => !prev)}
                >
                  {statusSortAsc ? (
                    <><ArrowUp className="mr-1 h-3 w-3" /> Plus basses</>
                  ) : (
                    <><ArrowDown className="mr-1 h-3 w-3" /> Plus hautes</>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setSelectedStatus(null)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {sortedStatusDrivers.length === 0 ? (
              <p className="py-4 text-center text-muted-foreground">Aucun conducteur</p>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code salarié</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">
                        <button
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          onClick={() => setStatusSortAsc((prev) => !prev)}
                        >
                          Compteur moy.
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedStatusDrivers.map((d) => (
                      <TableRow key={d.driverId}>
                        <TableCell>
                          <Link
                            href={`/heures/drivers/${d.driverId}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {d.codeSalarie}
                          </Link>
                        </TableCell>
                        <TableCell>{d.vehicleType}</TableCell>
                        <TableCell className="text-right font-mono font-medium">
                          <span
                            className={
                              d.avgCounter > 10
                                ? "text-red-600"
                                : d.avgCounter < 0
                                ? "text-blue-600"
                                : "text-emerald-600"
                            }
                          >
                            {d.avgCounter.toFixed(2)}h
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Bucket drill-down detail */}
      {selectedBucket && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 rounded-sm"
                  style={{ backgroundColor: BUCKET_COLORS[selectedBucket] || "#6366f1" }}
                />
                Conducteurs : {selectedBucket}
                <span className="text-muted-foreground font-normal text-sm">
                  ({bucketDrivers.length})
                </span>
              </CardTitle>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setBucketSortAsc((prev) => !prev)}
                >
                  {bucketSortAsc ? (
                    <><ArrowUp className="mr-1 h-3 w-3" /> Plus basses</>
                  ) : (
                    <><ArrowDown className="mr-1 h-3 w-3" /> Plus hautes</>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setSelectedBucket(null)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {sortedBucketDrivers.length === 0 ? (
              <p className="py-4 text-center text-muted-foreground">Aucun conducteur</p>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code salarié</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">
                        <button
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          onClick={() => setBucketSortAsc((prev) => !prev)}
                        >
                          Compteur moy.
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedBucketDrivers.map((d) => (
                      <TableRow key={d.driverId}>
                        <TableCell>
                          <Link
                            href={`/heures/drivers/${d.driverId}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {d.codeSalarie}
                          </Link>
                        </TableCell>
                        <TableCell>{d.vehicleType}</TableCell>
                        <TableCell className="text-right font-mono font-medium">
                          <span
                            className={
                              d.avgCounter > 10
                                ? "text-red-600"
                                : d.avgCounter < 0
                                ? "text-blue-600"
                                : "text-emerald-600"
                            }
                          >
                            {d.avgCounter.toFixed(2)}h
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Monthly evolution */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Évaluation mensuelle des heures</CardTitle>
            <div className="flex gap-1.5">
              {([
                { key: "Heures payées", color: "#ef4444", label: "Payées" },
                { key: "Heures manquantes", color: "#3b82f6", label: "Manquantes" },
              ] as const).map(({ key, color, label }) => {
                const active = visibleLines.has(key);
                return (
                  <Button
                    key={key}
                    size="sm"
                    variant={active ? "default" : "outline"}
                    className="text-xs h-7 px-2.5"
                    style={active ? { backgroundColor: color, borderColor: color } : { color, borderColor: color }}
                    onClick={() => {
                      setVisibleLines((prev) => {
                        const next = new Set(prev);
                        if (next.has(key)) {
                          if (next.size > 1) next.delete(key);
                        } else {
                          next.add(key);
                        }
                        return next;
                      });
                    }}
                  >
                    {label}
                  </Button>
                );
              })}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {monthlyAvg.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">Aucune donnée</p>
          ) : (
            <ResponsiveContainer width="100%" height={350}>
              <LineChart data={monthlyAvg} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="name" fontSize={11} interval={0} angle={-45} textAnchor="end" height={60} />
                <YAxis fontSize={12} />
                <Tooltip
                  formatter={(value, name) => [`${Number(value).toFixed(2)}h`, name]}
                  contentStyle={{
                    borderRadius: "8px",
                    border: "1px solid hsl(var(--border))",
                  }}
                />
                <Legend />
                {visibleLines.has("Heures payées") && (
                  <Line
                    type="monotone"
                    dataKey="heuresPayees"
                    name="Heures payées"
                    stroke="#ef4444"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                  />
                )}
                {visibleLines.has("Heures manquantes") && (
                  <Line
                    type="monotone"
                    dataKey="heuresManquantes"
                    name="Heures manquantes"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Monthly positive/negative hours evolution */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Évolution mensuelle des heures positives et négatives</CardTitle>
            <div className="flex items-center gap-3">
              <div className="flex rounded-md border overflow-hidden">
                <Button
                  size="sm"
                  variant={hoursMode === "sum" ? "default" : "ghost"}
                  className="text-xs h-7 px-3 rounded-none"
                  onClick={() => setHoursMode("sum")}
                >
                  Somme
                </Button>
                <Button
                  size="sm"
                  variant={hoursMode === "avg" ? "default" : "ghost"}
                  className="text-xs h-7 px-3 rounded-none"
                  onClick={() => setHoursMode("avg")}
                >
                  Moy/conducteur
                </Button>
              </div>
            <div className="flex gap-1.5">
              {([
                { key: "Heures positives", color: "#22c55e", label: "Positives" },
                { key: "Heures négatives", color: "#3b82f6", label: "Négatives" },
              ] as const).map(({ key, color, label }) => {
                const active = visibleHoursLines.has(key);
                return (
                  <Button
                    key={key}
                    size="sm"
                    variant={active ? "default" : "outline"}
                    className="text-xs h-7 px-2.5"
                    style={active ? { backgroundColor: color, borderColor: color } : { color, borderColor: color }}
                    onClick={() => {
                      setVisibleHoursLines((prev) => {
                        const next = new Set(prev);
                        if (next.has(key)) {
                          if (next.size > 1) next.delete(key);
                        } else {
                          next.add(key);
                        }
                        return next;
                      });
                    }}
                  >
                    {label}
                  </Button>
                );
              })}
            </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {monthlyHours.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">Aucune donnée</p>
          ) : (
            <ResponsiveContainer width="100%" height={350}>
              <LineChart data={monthlyHours.map((d) => {
                const divisor = hoursMode === "avg" && d.driverCount > 0 ? d.driverCount : 1;
                return {
                  name: d.name,
                  heuresPositives: Number((d.heuresPositives / divisor).toFixed(2)),
                  heuresNegatives: Number((d.heuresNegatives / divisor).toFixed(2)),
                };
              })} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="name" fontSize={11} interval={0} angle={-45} textAnchor="end" height={60} />
                <YAxis fontSize={12} />
                <Tooltip
                  formatter={(value, name) => [`${Number(value).toFixed(2)}h`, name]}
                  contentStyle={{
                    borderRadius: "8px",
                    border: "1px solid hsl(var(--border))",
                  }}
                />
                <Legend />
                {visibleHoursLines.has("Heures positives") && (
                  <Line
                    type="monotone"
                    dataKey="heuresPositives"
                    name="Heures positives"
                    stroke="#22c55e"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                  />
                )}
                {visibleHoursLines.has("Heures négatives") && (
                  <Line
                    type="monotone"
                    dataKey="heuresNegatives"
                    name="Heures négatives"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
