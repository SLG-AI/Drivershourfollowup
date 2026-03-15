"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { ChevronDown } from "lucide-react";
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
  Brush,
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
  scenario_apres_conges?: number;
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
    scenario_apres_conges?: number;
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
  { key: "effectif_apres_mct", label: "Après MCT", color: "hsl(330, 70%, 55%)", dashed: true },
  { key: "effectif_apres_injustifiees", label: "Après abs. injustifiées", color: "hsl(45, 93%, 47%)" },
  { key: "target", label: "Cible", color: "hsl(0, 84%, 60%)", dashed: true },
  { key: "scenario_brut", label: "Scénario — sous contrat", color: "hsl(221, 83%, 53%)", dashed: true, isScenario: true },
  { key: "scenario_net", label: "Scénario — net", color: "hsl(262, 83%, 58%)", dashed: true, isScenario: true },
  { key: "scenario_reel", label: "Scénario — réel (après CNS)", color: "hsl(142, 71%, 45%)", dashed: true, isScenario: true },
  { key: "scenario_apres_mct", label: "Scénario — après MCT", color: "hsl(330, 70%, 55%)", dashed: true, isScenario: true },
  { key: "scenario_apres_conges", label: "Effectif disponible (après congés)", color: "hsl(30, 90%, 50%)", dashed: true, isScenario: true },
];

interface Props {
  data: HeadcountDataPoint[];
  title?: string;
  scenarios?: ScenarioOption[];
  scenarioProjections?: ScenarioProjectionData[];
  initialSelectedScenarios?: string[];
  initialTurnoverSrc?: string | null;
  initialAbsSrc?: string | null;
  initialLeaveSrc?: string | null;
  combinedProjection?: ScenarioProjectionData | null;
}

export function HeadcountEvolutionChart({
  data,
  title = "Évolution des effectifs",
  scenarios = [],
  scenarioProjections = [],
  initialSelectedScenarios = [],
  initialTurnoverSrc = null,
  initialAbsSrc = null,
  initialLeaveSrc = null,
  combinedProjection = null,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(initialSelectedScenarios));
  const [turnoverSrc, setTurnoverSrc] = useState<string | null>(initialTurnoverSrc);
  const [absSrc, setAbsSrc] = useState<string | null>(initialAbsSrc);
  const [leaveSrc, setLeaveSrc] = useState<string | null>(initialLeaveSrc);
  const [urlDirty, setUrlDirty] = useState(false);

  // Sync selection to URL query params via useEffect (avoids setState during render)
  useEffect(() => {
    if (!urlDirty) return;
    setUrlDirty(false);

    const params = new URLSearchParams(searchParams.toString());

    if (selectedIds.size > 0) {
      params.set("scenarios", Array.from(selectedIds).join(","));
    } else {
      params.delete("scenarios");
    }

    if (turnoverSrc && selectedIds.has(turnoverSrc)) {
      params.set("turnover_src", turnoverSrc);
    } else {
      params.delete("turnover_src");
    }

    if (absSrc && selectedIds.has(absSrc)) {
      params.set("abs_src", absSrc);
    } else {
      params.delete("abs_src");
    }

    if (leaveSrc && selectedIds.has(leaveSrc)) {
      params.set("leave_src", leaveSrc);
    } else {
      params.delete("leave_src");
    }

    router.replace(`?${params.toString()}`, { scroll: false });
  }, [urlDirty, selectedIds, turnoverSrc, absSrc, leaveSrc, router, searchParams]);

  const toggleScenario = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (turnoverSrc === id) {
          setTurnoverSrc(next.size > 0 ? Array.from(next)[0] : null);
        }
        if (absSrc === id) {
          setAbsSrc(next.size > 0 ? Array.from(next)[0] : null);
        }
        if (leaveSrc === id) {
          setLeaveSrc(next.size > 0 ? Array.from(next)[0] : null);
        }
      } else {
        next.add(id);
        if (!turnoverSrc || !next.has(turnoverSrc)) {
          setTurnoverSrc(id);
        }
        if (!absSrc || !next.has(absSrc)) {
          setAbsSrc(id);
        }
        if (!leaveSrc || !next.has(leaveSrc)) {
          setLeaveSrc(id);
        }
      }
      return next;
    });
    setUrlDirty(true);
  };

  const setTurnoverSource = (id: string) => {
    setTurnoverSrc(id);
    setUrlDirty(true);
  };

  const setAbsSource = (id: string) => {
    setAbsSrc(id);
    setUrlDirty(true);
  };

  const setLeaveSource = (id: string) => {
    setLeaveSrc(id);
    setUrlDirty(true);
  };

  const showScenario = selectedIds.size > 0 && combinedProjection != null;

  // Use combined projection when multi-select is active
  const selectedProjection = showScenario ? combinedProjection : null;

  const firstProjectedMonthIdx = selectedProjection
    ? Math.min(...selectedProjection.months.map((m) => m.month_index))
    : null;
  const lastRealMonthIdx = firstProjectedMonthIdx != null ? firstProjectedMonthIdx - 1 : null;

  const lastMctRealMonth = data.reduce((last, d, i) => d.effectif_apres_mct != null ? i + 1 : last, 0);

  const chartData = data.map((d, idx) => {
    // Merge projected_apres_mct into effectif_apres_mct for a single continuous line
    const merged = d.projected_apres_mct != null && d.effectif_apres_mct == null
      ? { ...d, effectif_apres_mct: d.projected_apres_mct }
      : d;
    if (!showScenario || !selectedProjection) return merged;
    const monthIndex = idx + 1;

    if (monthIndex === lastMctRealMonth && lastMctRealMonth < (lastRealMonthIdx ?? 0)) {
      return {
        ...merged,
        scenario_apres_mct: merged.effectif_apres_mct,
      };
    }

    if (monthIndex === lastRealMonthIdx) {
      return {
        ...merged,
        scenario_brut: merged.effectif_brut,
        scenario_net: merged.effectif_net,
        scenario_reel: merged.effectif_reel,
        scenario_apres_mct: merged.effectif_apres_mct ?? merged.effectif_reel,
      };
    }

    const monthData = selectedProjection.months.find((m) => m.month_index === monthIndex);
    if (!monthData) return merged;
    return {
      ...merged,
      effectif_brut: undefined,
      effectif_net: undefined,
      effectif_reel: undefined,
      effectif_apres_mct: undefined,
      effectif_apres_injustifiees: undefined,
      scenario_brut: monthData.scenario_brut,
      scenario_net: monthData.scenario_net,
      scenario_reel: monthData.scenario_reel,
      scenario_apres_mct: monthData.scenario_apres_mct,
      scenario_apres_conges: monthData.scenario_apres_conges,
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

  const hasData: Record<string, boolean> = {
    effectif_brut: !showScenario,
    effectif_net: !showScenario,
    effectif_reel: !showScenario && chartData.some((d) => d.effectif_reel != null),
    effectif_apres_mct: !showScenario && chartData.some((d) => d.effectif_apres_mct != null),
    effectif_apres_injustifiees: !showScenario && chartData.some((d) => d.effectif_apres_injustifiees != null),
    target: chartData.some((d) => d.target != null),
    scenario_brut: showScenario && chartData.some((d) => d.scenario_brut != null),
    scenario_net: showScenario && chartData.some((d) => d.scenario_net != null),
    scenario_reel: showScenario && chartData.some((d) => d.scenario_reel != null),
    scenario_apres_mct: showScenario && chartData.some((d) => d.scenario_apres_mct != null),
    scenario_apres_conges: showScenario && chartData.some((d) => d.scenario_apres_conges != null),
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

  const projectionStartIndex = chartData.findIndex((d) => d.is_projection);

  const allValues = chartData.flatMap((d) =>
    visibleSeries.map((s) => (d as Record<string, unknown>)[s.key] as number | undefined).filter((v): v is number => v != null)
  );
  const dataMin = allValues.length > 0 ? Math.min(...allValues) : 0;
  const dataMax = allValues.length > 0 ? Math.max(...allValues) : 100;
  const range = dataMax - dataMin || 1;
  const padding = Math.max(range * 0.15, 5);
  const yMin = Math.max(0, Math.floor((dataMin - padding) / 10) * 10);
  const yMax = Math.ceil((dataMax + padding) / 10) * 10;

  const labelMap: Record<string, string> = {};
  ALL_SERIES.forEach((s) => { labelMap[s.key] = s.label; });

  // Helper to get scenario name by id
  const getScenarioName = (id: string | null) => scenarios.find((s) => s.id === id)?.name ?? "—";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-base">{title}</CardTitle>
          {scenarios.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                  {selectedIds.size > 0 ? (
                    <>
                      <Badge variant="secondary" className="text-xs px-1.5 py-0">
                        {selectedIds.size} scénario{selectedIds.size > 1 ? "s" : ""}
                      </Badge>
                      <ChevronDown className="h-3.5 w-3.5 opacity-50" />
                    </>
                  ) : (
                    <>
                      Scénarios
                      <ChevronDown className="h-3.5 w-3.5 opacity-50" />
                    </>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[380px] p-0" align="end">
                <div className="p-3 border-b">
                  <p className="text-sm font-medium">Combiner des scénarios</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Les hypothèses s&apos;additionnent. Choisissez la source des taux.
                  </p>
                </div>
                <div className="max-h-[300px] overflow-y-auto p-2 space-y-1">
                  {scenarios.map((sc) => {
                    const isSelected = selectedIds.has(sc.id);
                    return (
                      <div
                        key={sc.id}
                        className={`rounded-md border p-2 transition-colors ${isSelected ? "border-primary/30 bg-primary/5" : "border-transparent"}`}
                      >
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id={`sc-${sc.id}`}
                            checked={isSelected}
                            onCheckedChange={() => toggleScenario(sc.id)}
                          />
                          <label
                            htmlFor={`sc-${sc.id}`}
                            className="text-sm font-medium cursor-pointer flex-1"
                          >
                            {sc.name}
                          </label>
                        </div>
                        {isSelected && (
                          <div className="flex gap-3 mt-2 ml-6">
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="radio"
                                name="turnover_src"
                                checked={turnoverSrc === sc.id}
                                onChange={() => setTurnoverSource(sc.id)}
                                className="h-3 w-3 accent-primary"
                              />
                              <span className="text-xs text-muted-foreground">Turnover</span>
                            </label>
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="radio"
                                name="abs_src"
                                checked={absSrc === sc.id}
                                onChange={() => setAbsSource(sc.id)}
                                className="h-3 w-3 accent-primary"
                              />
                              <span className="text-xs text-muted-foreground">Absentéisme</span>
                            </label>
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="radio"
                                name="leave_src"
                                checked={leaveSrc === sc.id}
                                onChange={() => setLeaveSource(sc.id)}
                                className="h-3 w-3 accent-primary"
                              />
                              <span className="text-xs text-muted-foreground">Congés</span>
                            </label>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {selectedIds.size > 0 && (
                  <div className="p-2 border-t text-xs text-muted-foreground space-y-0.5">
                    <div>Turnover : <span className="font-medium text-foreground">{getScenarioName(turnoverSrc)}</span></div>
                    <div>Absentéisme : <span className="font-medium text-foreground">{getScenarioName(absSrc)}</span></div>
                    <div>Congés : <span className="font-medium text-foreground">{getScenarioName(leaveSrc)}</span></div>
                  </div>
                )}
              </PopoverContent>
            </Popover>
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
        <ResponsiveContainer width="100%" height={400}>
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
                  effectif_apres_mct: 3, effectif_apres_injustifiees: 4, target: 5,
                  scenario_brut: 6, scenario_net: 7, scenario_reel: 8, scenario_apres_mct: 9, scenario_apres_conges: 10,
                };
                return order[String(item.dataKey)] ?? 99;
              }}
              labelFormatter={() => ""}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(value: any, name: any, _props: any, _index: any, payload: any) => {
                const label = labelMap[String(name)] || String(name);
                const val = value ?? 0;
                const key = String(name);

                const deltaParent: Record<string, string> = {
                  effectif_net: "effectif_brut",
                  effectif_reel: "effectif_net",
                  effectif_apres_mct: "effectif_reel",
                  effectif_apres_injustifiees: "effectif_apres_mct",
                  scenario_net: "scenario_brut",
                  scenario_reel: "scenario_net",
                  scenario_apres_mct: "scenario_reel",
                  scenario_apres_conges: "scenario_apres_mct",
                };

                const parentKey = deltaParent[key];
                if (parentKey) {
                  const parent = payload.find((p: { dataKey: string; value: number }) => p.dataKey === parentKey);
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

            <Brush
              dataKey="month"
              height={24}
              stroke="#d1d5db"
              fill="#f9fafb"
              travellerWidth={8}
              startIndex={0}
              endIndex={chartData.length - 1}
            >
              <LineChart data={chartData}>
                <Line type="monotone" dataKey="effectif_brut" stroke="#93c5fd" strokeWidth={1} dot={false} />
              </LineChart>
            </Brush>
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
