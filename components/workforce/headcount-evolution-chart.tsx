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
  projected_apres_mct?: number;
  effectif_apres_injustifiees?: number;
  is_projection: boolean;
  target?: number;
  scenario_brut?: number;
  scenario_net?: number;
  scenario_reel?: number;
  scenario_apres_mct?: number;
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
    scenario_apres_mct: number;
  }[];
}

interface SeriesDef {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
  isScenario?: boolean;
}

const ALL_SERIES: SeriesDef[] = [
  { key: "effectif_brut", label: "Sous contrat", color: "hsl(221, 83%, 53%)" },
  { key: "effectif_net", label: "Net", color: "hsl(262, 83%, 58%)" },
  { key: "effectif_reel", label: "Réel (après maladie)", color: "hsl(142, 71%, 45%)" },
  { key: "effectif_apres_mct", label: "Après MCT", color: "hsl(330, 70%, 55%)" },
  { key: "projected_apres_mct", label: "Après MCT (projeté)", color: "hsl(330, 70%, 55%)", dashed: true },
  { key: "effectif_apres_injustifiees", label: "Après abs. injustifiées", color: "hsl(45, 93%, 47%)" },
  { key: "target", label: "Cible", color: "hsl(0, 84%, 60%)", dashed: true },
  { key: "scenario_brut", label: "Scénario — sous contrat", color: "hsl(221, 83%, 53%)", dashed: true, isScenario: true },
  { key: "scenario_net", label: "Scénario — net", color: "hsl(262, 83%, 58%)", dashed: true, isScenario: true },
  { key: "scenario_reel", label: "Scénario — réel (après CNS)", color: "hsl(142, 71%, 45%)", dashed: true, isScenario: true },
  { key: "scenario_apres_mct", label: "Scénario — après MCT", color: "hsl(330, 70%, 55%)", dashed: true, isScenario: true },
];

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
  // When a scenario is active, hide solid lines for projected months
  // (the dashed scenario lines take over)
  const selectedProjection = showScenario
    ? scenarioProjections.find((sp) => sp.scenario_id === selectedScenarioId)
    : null;
  const firstProjectedMonthIdx = selectedProjection
    ? Math.min(...selectedProjection.months.map((m) => m.month_index))
    : null;
  // Le dernier mois réel = mois juste avant la première projection
  const lastRealMonthIdx = firstProjectedMonthIdx != null ? firstProjectedMonthIdx - 1 : null;

  // Trouver le dernier mois ayant des données MCT réelles (pour jonction scénario)
  const lastMctRealMonth = data.reduce((last, d, i) => d.effectif_apres_mct != null ? i + 1 : last, 0);

  const chartData = data.map((d, idx) => {
    if (!showScenario || !selectedProjection) return d;
    const monthIndex = idx + 1;

    // Sur le dernier mois avec données MCT réelles, ajouter le point de jonction scenario_apres_mct
    if (monthIndex === lastMctRealMonth && lastMctRealMonth < (lastRealMonthIdx ?? 0)) {
      return {
        ...d,
        scenario_apres_mct: d.effectif_apres_mct,
      };
    }

    // Sur le dernier mois réel, ajouter les valeurs scénario = valeurs réelles
    // pour que les pointillés démarrent depuis ce point
    if (monthIndex === lastRealMonthIdx) {
      return {
        ...d,
        scenario_brut: d.effectif_brut,
        scenario_net: d.effectif_net,
        scenario_reel: d.effectif_reel,
        scenario_apres_mct: d.effectif_apres_mct ?? d.projected_apres_mct ?? d.effectif_reel,
      };
    }

    const monthData = selectedProjection.months.find((m) => m.month_index === monthIndex);
    if (!monthData) return d;
    return {
      ...d,
      // Masquer les lignes continues pour les mois projetés couverts par le scénario
      effectif_brut: undefined,
      effectif_net: undefined,
      effectif_reel: undefined,
      effectif_apres_mct: undefined,
      projected_apres_mct: undefined,
      effectif_apres_injustifiees: undefined,
      scenario_brut: monthData.scenario_brut,
      scenario_net: monthData.scenario_net,
      scenario_reel: monthData.scenario_reel,
      scenario_apres_mct: monthData.scenario_apres_mct,
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

  // Determine which series have data
  const hasData: Record<string, boolean> = {
    effectif_brut: true,
    effectif_net: true,
    effectif_reel: chartData.some((d) => d.effectif_reel != null),
    effectif_apres_mct: chartData.some((d) => d.effectif_apres_mct != null),
    projected_apres_mct: chartData.some((d) => d.projected_apres_mct != null),
    effectif_apres_injustifiees: chartData.some((d) => d.effectif_apres_injustifiees != null),
    target: chartData.some((d) => d.target != null),
    scenario_brut: showScenario && chartData.some((d) => d.scenario_brut != null),
    scenario_net: showScenario && chartData.some((d) => d.scenario_net != null),
    scenario_reel: showScenario && chartData.some((d) => d.scenario_reel != null),
    scenario_apres_mct: showScenario && chartData.some((d) => d.scenario_apres_mct != null),
  };

  const availableSeries = ALL_SERIES.filter((s) => hasData[s.key]);

  // Visibility state — all visible by default
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());

  const toggleSeries = (key: string) => {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const visibleSeries = availableSeries.filter((s) => !hiddenSeries.has(s.key));

  // Find the boundary between real and projected data
  const projectionStartIndex = chartData.findIndex((d) => d.is_projection);

  // Auto-scale Y axis based on visible series only
  const allValues = chartData.flatMap((d) =>
    visibleSeries.map((s) => (d as Record<string, unknown>)[s.key] as number | undefined).filter((v): v is number => v != null)
  );
  const dataMin = allValues.length > 0 ? Math.min(...allValues) : 0;
  const dataMax = allValues.length > 0 ? Math.max(...allValues) : 100;
  const range = dataMax - dataMin || 1;
  const padding = Math.max(range * 0.15, 5);
  const yMin = Math.max(0, Math.floor((dataMin - padding) / 10) * 10);
  const yMax = Math.ceil((dataMax + padding) / 10) * 10;

  // Tooltip labels
  const labelMap: Record<string, string> = {};
  ALL_SERIES.forEach((s) => { labelMap[s.key] = s.label; });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
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

        {/* Series toggles */}
        <div className="flex flex-wrap gap-2 pt-2">
          {availableSeries.map((s) => {
            const active = !hiddenSeries.has(s.key);
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => toggleSeries(s.key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  active
                    ? "border-transparent text-white"
                    : "border-border bg-muted/40 text-muted-foreground"
                }`}
                style={active ? { backgroundColor: s.color } : undefined}
              >
                <span
                  className="inline-block h-2 w-4 rounded-sm"
                  style={{
                    backgroundColor: active ? "rgba(255,255,255,0.6)" : s.color,
                    borderBottom: s.dashed ? `2px dashed ${active ? "rgba(255,255,255,0.8)" : s.color}` : undefined,
                  }}
                />
                {s.label}
              </button>
            );
          })}
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
                  effectif_brut: 0, effectif_net: 1, effectif_reel: 2,
                  effectif_apres_mct: 3, projected_apres_mct: 3.5, effectif_apres_injustifiees: 4, target: 5,
                  scenario_brut: 6, scenario_net: 7, scenario_reel: 8, scenario_apres_mct: 9,
                };
                return order[String(item.dataKey)] ?? 99;
              }}
              labelFormatter={() => ""}
              formatter={(value: number, name: string, _props: unknown, _index: number, payload: Array<{ dataKey: string; value: number }>) => {
                const label = labelMap[String(name)] || String(name);
                const val = value ?? 0;
                const key = String(name);

                // Define which line each should compare to for delta
                const deltaParent: Record<string, string> = {
                  effectif_net: "effectif_brut",
                  effectif_reel: "effectif_net",
                  effectif_apres_mct: "effectif_reel",
                  projected_apres_mct: "effectif_reel",
                  effectif_apres_injustifiees: "effectif_apres_mct",
                  scenario_net: "scenario_brut",
                  scenario_reel: "scenario_net",
                  scenario_apres_mct: "scenario_reel",
                };

                const parentKey = deltaParent[key];
                if (parentKey) {
                  const parent = payload.find((p) => p.dataKey === parentKey);
                  if (parent?.value != null) {
                    const delta = val - parent.value;
                    const sign = delta >= 0 ? "+" : "";
                    return [<span key={key}>{val} <span style={{ fontSize: "0.75em", color: "#999" }}>({sign}{Math.round(delta * 10) / 10})</span></span>, label];
                  }
                }
                return [val, label];
              }}
            />
            <Legend
              content={() => null}
            />

            {/* Render only visible series */}
            {visibleSeries.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray={s.dashed ? (s.isScenario ? "6 3" : "8 4") : undefined}
                dot={s.key === "target" ? false : { r: s.isScenario ? 2 : 3 }}
                activeDot={s.key === "effectif_brut" ? { r: 5 } : undefined}
                connectNulls={s.dashed === true}
              />
            ))}

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
