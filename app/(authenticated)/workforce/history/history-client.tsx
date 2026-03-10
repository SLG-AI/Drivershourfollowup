"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { FRENCH_MONTHS_SHORT } from "@/lib/constants";
import { Activity, TrendingDown, Users, Info } from "lucide-react";

const YEAR_COLORS = [
  "hsl(221, 83%, 53%)",
  "hsl(262, 83%, 58%)",
  "hsl(0, 84%, 60%)",
  "hsl(45, 93%, 47%)",
  "hsl(142, 71%, 45%)",
];

interface Props {
  absenteeismSeries: { year: number; data: { mois: number; avg_rate: number | null }[] }[];
  absTypeData: { type: string; hours: number }[];
  turnoverByYear: { year: number; effectif: number; departures: number; arrivals: number; rate: number }[];
  motifData: { motif: string; count: number }[];
  headcountByYearMonth: { year: number; data: { mois: number; count: number }[] }[];
  suggestedAbsenteeism: Record<number, number>;
  suggestedTurnover: number;
  years: number[];
}

export function HistoryClient({
  absenteeismSeries,
  absTypeData,
  turnoverByYear,
  motifData,
  headcountByYearMonth,
  suggestedAbsenteeism,
  suggestedTurnover,
  years,
}: Props) {
  // Build absenteeism chart data (months as rows, years as columns)
  const absChartData = Array.from({ length: 12 }, (_, i) => {
    const row: Record<string, number | string> = { month: FRENCH_MONTHS_SHORT[i + 1] };
    absenteeismSeries.forEach((series) => {
      const entry = series.data[i];
      if (entry?.avg_rate !== null && entry?.avg_rate !== undefined) {
        row[String(series.year)] = Math.round(entry.avg_rate * 10) / 10;
      }
    });
    return row;
  });

  // Build headcount chart data
  const hcChartData = Array.from({ length: 12 }, (_, i) => {
    const row: Record<string, number | string> = { month: FRENCH_MONTHS_SHORT[i + 1] };
    headcountByYearMonth.forEach((series) => {
      const entry = series.data[i];
      if (entry) row[String(series.year)] = entry.count;
    });
    return row;
  });

  const tooltipStyle = {
    borderRadius: "8px",
    border: "1px solid hsl(var(--border))",
    backgroundColor: "hsl(var(--background))",
  };

  return (
    <>
      {/* Suggested values card */}
      <Card className="border-blue-200 bg-blue-50/30">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Info className="h-4 w-4 text-blue-600" />
            Valeurs suggérées pour les scénarios
          </CardTitle>
          <CardDescription>
            Basées sur la moyenne historique des données importées.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Turnover annuel moyen</p>
              <p className="text-xl font-bold">{suggestedTurnover}%</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Absentéisme moyen annuel</p>
              <p className="text-xl font-bold">
                {(Object.values(suggestedAbsenteeism).reduce((a, b) => a + b, 0) / 12).toFixed(1)}%
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Mois le plus absent</p>
              <p className="text-xl font-bold">
                {FRENCH_MONTHS_SHORT[
                  Number(Object.entries(suggestedAbsenteeism).sort((a, b) => b[1] - a[1])[0]?.[0]) || 1
                ]}
                {" "}({Math.max(...Object.values(suggestedAbsenteeism)).toFixed(1)}%)
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Années de données</p>
              <p className="text-xl font-bold">{years.length}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Absenteeism seasonal overlay */}
      {absenteeismSeries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Saisonnalité de l&apos;absentéisme
            </CardTitle>
            <CardDescription>Taux moyen mensuel par année</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={absChartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} unit="%" />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend />
                {absenteeismSeries.map((series, i) => (
                  <Line
                    key={series.year}
                    type="monotone"
                    dataKey={String(series.year)}
                    stroke={YEAR_COLORS[i % YEAR_COLORS.length]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Absence type breakdown */}
        {absTypeData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Répartition par type d&apos;absence</CardTitle>
              <CardDescription>Heures totales cumulées</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={absTypeData} layout="vertical" margin={{ left: 100, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="type" tick={{ fontSize: 12 }} width={90} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="hours" name="Heures" fill="hsl(262, 83%, 58%)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Turnover by year */}
        {turnoverByYear.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingDown className="h-4 w-4" />
                Turnover annuel
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={turnoverByYear} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="year" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend />
                  <Bar dataKey="departures" name="Départs" fill="hsl(0, 84%, 60%)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="arrivals" name="Arrivées" fill="hsl(142, 71%, 45%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-3 flex gap-4">
                {turnoverByYear.map((t) => (
                  <div key={t.year} className="text-center">
                    <p className="text-xs text-muted-foreground">{t.year}</p>
                    <p className="text-sm font-medium">{t.rate}%</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Headcount evolution overlay */}
      {headcountByYearMonth.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              Évolution des effectifs par année
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={hcChartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend />
                {headcountByYearMonth.map((series, i) => (
                  <Line
                    key={series.year}
                    type="monotone"
                    dataKey={String(series.year)}
                    stroke={YEAR_COLORS[i % YEAR_COLORS.length]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Departure motifs table */}
      {motifData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Motifs de départ</CardTitle>
            <CardDescription>Répartition historique des motifs de sortie</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Motif</TableHead>
                  <TableHead className="text-xs text-right">Nombre</TableHead>
                  <TableHead className="text-xs text-right">Part</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {motifData.map((d) => {
                  const total = motifData.reduce((s, m) => s + m.count, 0);
                  const pct = total > 0 ? ((d.count / total) * 100).toFixed(1) : "0";
                  return (
                    <TableRow key={d.motif}>
                      <TableCell className="text-sm">{d.motif}</TableCell>
                      <TableCell className="text-sm text-right font-medium">{d.count}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className="text-xs">{pct}%</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
