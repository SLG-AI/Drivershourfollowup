"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";

export interface HeadcountDataPoint {
  month: string;
  effectif_brut: number;
  effectif_net: number;
  effectif_reel?: number;
  effectif_apres_mct?: number;
  is_projection: boolean;
  target?: number;
  scenario_brut?: number;
  scenario_net?: number;
  scenario_reel?: number;
}

export interface ScenarioOption {
  id: string;
  name: string;
}

export interface ScenarioProjectionData {
  scenario_id: string;
  /** One entry per projected month (only future months) */
  months: {
    month_index: number; // 1-12
    scenario_brut: number;
    scenario_net: number;
    scenario_reel: number;
  }[];
}

interface Props {
  data: HeadcountDataPoint[];
  title?: string;
  scenarios?: ScenarioOption[];
  scenarioProjections?: ScenarioProjectionData[];
}

export function HeadcountEvolutionChart({
  data,
  title = "Évolution des effectifs",
  scenarios = [],
  scenarioProjections = [],
}: Props) {
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const showScenario = selectedScenarioId !== null;

  // Merge scenario projection data into chart data
  const chartData = data.map((d, idx) => {
    if (!showScenario) return d;
    const projection = scenarioProjections.find((sp) => sp.scenario_id === selectedScenarioId);
    if (!projection) return d;
    const monthData = projection.months.find((m) => m.month_index === idx + 1);
    if (!monthData) return d;
    return {
      ...d,
      scenario_brut: monthData.scenario_brut,
      scenario_net: monthData.scenario_net,
      scenario_reel: monthData.scenario_reel,
    };
  });
  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">
            Importez des données pour visualiser l&apos;évolution des effectifs.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Find the boundary between real and projected data
  const projectionStartIndex = chartData.findIndex((d) => d.is_projection);
  const hasTarget = chartData.some((d) => d.target != null);
  const hasScenarioData = showScenario && chartData.some((d) => d.scenario_brut != null);

  // Auto-scale Y axis: find min/max across all series with some padding
  const hasEffectifReel = chartData.some((d) => d.effectif_reel != null);
  const hasEffectifApresMct = chartData.some((d) => d.effectif_apres_mct != null);

  const allValues = chartData.flatMap((d) => [
    d.effectif_brut,
    d.effectif_net,
    ...(d.effectif_reel != null ? [d.effectif_reel] : []),
    ...(d.effectif_apres_mct != null ? [d.effectif_apres_mct] : []),
    ...(d.target != null ? [d.target] : []),
    ...(d.scenario_brut != null ? [d.scenario_brut] : []),
    ...(d.scenario_net != null ? [d.scenario_net] : []),
    ...(d.scenario_reel != null ? [d.scenario_reel] : []),
  ]);
  const dataMin = Math.min(...allValues);
  const dataMax = Math.max(...allValues);
  const range = dataMax - dataMin || 1;
  const padding = Math.max(range * 0.15, 5);
  const yMin = Math.max(0, Math.floor((dataMin - padding) / 10) * 10);
  const yMax = Math.ceil((dataMax + padding) / 10) * 10;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          {scenarios.length > 0 && (
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">Scénario</Label>
              <Select
                value={selectedScenarioId ?? "__off__"}
                onValueChange={(v) => setSelectedScenarioId(v === "__off__" ? null : v)}
              >
                <SelectTrigger className="h-8 w-[200px] text-xs">
                  <SelectValue placeholder="Désactivé" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__off__">Désactivé</SelectItem>
                  {scenarios.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="month"
              tick={{ fontSize: 12 }}
              className="text-muted-foreground"
            />
            <YAxis
              tick={{ fontSize: 12 }}
              className="text-muted-foreground"
              domain={[yMin, yMax]}
            />
            <Tooltip
              contentStyle={{
                borderRadius: "8px",
                border: "1px solid hsl(var(--border))",
                backgroundColor: "hsl(var(--background))",
              }}
              itemSorter={(item) => {
                const order: Record<string, number> = {
                  effectif_brut: 0,
                  effectif_net: 1,
                  effectif_reel: 2,
                  effectif_apres_mct: 3,
                  target: 4,
                  scenario_brut: 5,
                  scenario_net: 6,
                  scenario_reel: 7,
                };
                return order[String(item.dataKey)] ?? 99;
              }}
              formatter={(value, name) => {
                const labels: Record<string, string> = {
                  effectif_brut: "Effectif sous contrat",
                  effectif_net: "Effectif net",
                  effectif_reel: "Effectif réel (après maladie)",
                  effectif_apres_mct: "Effectif après MCT",
                  target: "Cible",
                  scenario_brut: "Scénario — sous contrat",
                  scenario_net: "Scénario — net",
                  scenario_reel: "Scénario — réel",
                };
                return [value ?? 0, labels[String(name)] || String(name)];
              }}
            />
            <Legend
              formatter={(value: string) => {
                const labels: Record<string, string> = {
                  effectif_brut: "Effectif sous contrat",
                  effectif_net: "Effectif net",
                  effectif_reel: "Effectif réel (après maladie)",
                  effectif_apres_mct: "Effectif après MCT",
                  target: "Cible",
                  scenario_brut: "Scénario — sous contrat",
                  scenario_net: "Scénario — net",
                  scenario_reel: "Scénario — réel",
                };
                return labels[value] || value;
              }}
            />
            <Line
              type="monotone"
              dataKey="effectif_brut"
              stroke="hsl(221, 83%, 53%)"
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
            <Line
              type="monotone"
              dataKey="effectif_net"
              stroke="hsl(262, 83%, 58%)"
              strokeWidth={2}
              dot={{ r: 3 }}
            />
            {hasEffectifReel && (
              <Line
                type="monotone"
                dataKey="effectif_reel"
                stroke="hsl(142, 71%, 45%)"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            )}
            {hasEffectifApresMct && (
              <Line
                type="monotone"
                dataKey="effectif_apres_mct"
                stroke="hsl(330, 70%, 55%)"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            )}
            {hasTarget && (
              <Line
                type="monotone"
                dataKey="target"
                stroke="hsl(0, 84%, 60%)"
                strokeWidth={2}
                strokeDasharray="8 4"
                dot={false}
              />
            )}
            {hasScenarioData && (
              <>
                <Line
                  type="monotone"
                  dataKey="scenario_brut"
                  stroke="hsl(221, 83%, 53%)"
                  strokeWidth={2}
                  strokeDasharray="6 3"
                  dot={{ r: 2 }}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="scenario_net"
                  stroke="hsl(262, 83%, 58%)"
                  strokeWidth={2}
                  strokeDasharray="6 3"
                  dot={{ r: 2 }}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="scenario_reel"
                  stroke="hsl(142, 71%, 45%)"
                  strokeWidth={2}
                  strokeDasharray="6 3"
                  dot={{ r: 2 }}
                  connectNulls={false}
                />
              </>
            )}
            {projectionStartIndex > 0 && (
              <ReferenceLine
                x={data[projectionStartIndex].month}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="4 4"
                label={{ value: "Projection", position: "top", fontSize: 11 }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
