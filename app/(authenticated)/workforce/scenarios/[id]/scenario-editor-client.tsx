"use client";

import { useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { HeadcountEvolutionChart, type HeadcountDataPoint } from "@/components/workforce/headcount-evolution-chart";
import { projectHeadcount, type Employee, type AbsenceRecord, type ScenarioParams, type MonthlyParam, type MonthlyTurnoverParam, type ArrivalHypothesis, type TempExitHypothesis, type DepartureHypothesis } from "@/lib/utils/wp-calculations";
import { updateScenario } from "../actions";
import { ArrivalHypothesesTab } from "./arrival-hypotheses-tab";
import { TemporaryExitsTab } from "./temporary-exits-tab";
import { DepartureHypothesesTab } from "./departure-hypotheses-tab";
import { FRENCH_MONTHS_SHORT } from "@/lib/constants";
import { Save, ArrowLeft, Calendar, ChevronDown, RotateCcw, Repeat, Pencil } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

/** Key for global (fallback) rate - not tied to any cost center */
const GLOBAL_KEY = "__GLOBAL__";

interface ComboboxOptions {
  fonctions: string[];
  centres_cout: string[];
  depots: string[];
}

interface DbMonthlyParam {
  id: string;
  scenario_id: string;
  mois: number;
  projected_absenteeism_rate: number;
  centre_cout: string | null;
}

interface DbMonthlyTurnoverParam {
  id: string;
  scenario_id: string;
  mois: number;
  projected_turnover_rate: number;
  centre_cout: string | null;
}

interface DbMonthlyLeaveParam {
  id: string;
  scenario_id: string;
  mois: number;
  projected_leave_rate: number;
  centre_cout: string | null;
}

interface MonthlyLeaveParam {
  mois: number;
  leave_rate: number;
}

interface DbScenario {
  id: string;
  name: string;
  description: string | null;
  projected_turnover_rate: number;
}

interface Props {
  scenario: DbScenario;
  monthlyParams: DbMonthlyParam[];
  monthlyTurnoverParams: DbMonthlyTurnoverParam[];
  monthlyLeaveParams: DbMonthlyLeaveParam[];
  departureHypotheses: DepartureHypothesis[];
  arrivalHypotheses: ArrivalHypothesis[];
  tempExitHypotheses: TempExitHypothesis[];
  comboboxOptions: ComboboxOptions;
  employees: Employee[];
  absences: AbsenceRecord[];
  selectedYear: number;
  targetTotal?: number;
}

export function ScenarioEditorClient({
  scenario,
  monthlyParams: initialMonthlyParams,
  monthlyTurnoverParams: initialMonthlyTurnoverParams,
  monthlyLeaveParams: initialMonthlyLeaveParams,
  departureHypotheses: initialDepartureHypotheses,
  arrivalHypotheses: initialArrivalHypotheses,
  tempExitHypotheses: initialTempExitHypotheses,
  comboboxOptions,
  employees,
  absences,
  selectedYear,
  targetTotal,
}: Props) {
  // Editable state
  const [name, setName] = useState(scenario.name);
  const [description, setDescription] = useState(scenario.description || "");
  const [turnoverRate, setTurnoverRate] = useState(Number(scenario.projected_turnover_rate));
  const [uniformAbsenteeism, setUniformAbsenteeism] = useState(initialMonthlyParams.length > 0);
  const [saving, setSaving] = useState(false);

  // Monthly params state: Map<costCenterKey, MonthlyParam[]>
  // GLOBAL_KEY = global fallback rates, other keys = cost-center-specific
  const [allMonthlyParams, setAllMonthlyParams] = useState<Map<string, MonthlyParam[]>>(() => {
    const map = new Map<string, MonthlyParam[]>();

    // Group DB rows by centre_cout
    const grouped = new Map<string, DbMonthlyParam[]>();
    initialMonthlyParams.forEach((p) => {
      const key = p.centre_cout ?? GLOBAL_KEY;
      const arr = grouped.get(key) || [];
      arr.push(p);
      grouped.set(key, arr);
    });

    // Build MonthlyParam[] for each group
    for (const [key, dbParams] of grouped) {
      const params: MonthlyParam[] = [];
      for (let m = 1; m <= 12; m++) {
        const existing = dbParams.find((p) => p.mois === m);
        params.push({
          mois: m,
          absenteeism_rate: existing ? Number(existing.projected_absenteeism_rate) : 0,
        });
      }
      map.set(key, params);
    }

    // Ensure global always exists
    if (!map.has(GLOBAL_KEY)) {
      const params: MonthlyParam[] = [];
      for (let m = 1; m <= 12; m++) {
        params.push({ mois: m, absenteeism_rate: 0 });
      }
      map.set(GLOBAL_KEY, params);
    }

    return map;
  });

  // Monthly turnover params state: Map<costCenterKey, MonthlyTurnoverParam[]>
  const [allMonthlyTurnoverParams, setAllMonthlyTurnoverParams] = useState<Map<string, MonthlyTurnoverParam[]>>(() => {
    const map = new Map<string, MonthlyTurnoverParam[]>();

    const grouped = new Map<string, DbMonthlyTurnoverParam[]>();
    initialMonthlyTurnoverParams.forEach((p) => {
      const key = p.centre_cout ?? GLOBAL_KEY;
      const arr = grouped.get(key) || [];
      arr.push(p);
      grouped.set(key, arr);
    });

    for (const [key, dbParams] of grouped) {
      const params: MonthlyTurnoverParam[] = [];
      for (let m = 1; m <= 12; m++) {
        const existing = dbParams.find((p) => p.mois === m);
        params.push({
          mois: m,
          turnover_rate: existing ? Number(existing.projected_turnover_rate) : Number(scenario.projected_turnover_rate),
        });
      }
      map.set(key, params);
    }

    if (!map.has(GLOBAL_KEY)) {
      const params: MonthlyTurnoverParam[] = [];
      for (let m = 1; m <= 12; m++) {
        params.push({ mois: m, turnover_rate: Number(scenario.projected_turnover_rate) });
      }
      map.set(GLOBAL_KEY, params);
    }

    return map;
  });

  const [uniformTurnover, setUniformTurnover] = useState(false);

  // Leave params state: Map<costCenterKey, MonthlyLeaveParam[]>
  const [allMonthlyLeaveParams, setAllMonthlyLeaveParams] = useState<Map<string, MonthlyLeaveParam[]>>(() => {
    const map = new Map<string, MonthlyLeaveParam[]>();
    const grouped = new Map<string, DbMonthlyLeaveParam[]>();
    initialMonthlyLeaveParams.forEach((p) => {
      const key = p.centre_cout ?? GLOBAL_KEY;
      const arr = grouped.get(key) || [];
      arr.push(p);
      grouped.set(key, arr);
    });
    for (const [key, dbParams] of grouped) {
      const params: MonthlyLeaveParam[] = [];
      for (let m = 1; m <= 12; m++) {
        const existing = dbParams.find((p) => p.mois === m);
        params.push({ mois: m, leave_rate: existing ? Number(existing.projected_leave_rate) : 0 });
      }
      map.set(key, params);
    }
    if (!map.has(GLOBAL_KEY)) {
      const params: MonthlyLeaveParam[] = [];
      for (let m = 1; m <= 12; m++) {
        params.push({ mois: m, leave_rate: 0 });
      }
      map.set(GLOBAL_KEY, params);
    }
    return map;
  });

  const [uniformLeave, setUniformLeave] = useState(initialMonthlyLeaveParams.length > 0 && (() => {
    const globalParams = initialMonthlyLeaveParams.filter((p) => !p.centre_cout);
    if (globalParams.length === 0) return false;
    const firstRate = Number(globalParams[0].projected_leave_rate);
    return globalParams.every((p) => Number(p.projected_leave_rate) === firstRate);
  })());

  // Selected cost centers in the multi-select (for editing absenteeism)
  const [selectedCostCenters, setSelectedCostCenters] = useState<string[]>([GLOBAL_KEY]);

  // Selected cost centers for turnover tab
  const [selectedTurnoverCostCenters, setSelectedTurnoverCostCenters] = useState<string[]>([GLOBAL_KEY]);

  // Selected cost centers for leave tab
  const [selectedLeaveCostCenters, setSelectedLeaveCostCenters] = useState<string[]>([GLOBAL_KEY]);

  // Derive the "effective" monthly params for display (first selected, with global fallback)
  const displayedParams = useMemo((): MonthlyParam[] => {
    const first = selectedCostCenters[0] || GLOBAL_KEY;
    const specific = allMonthlyParams.get(first);
    if (specific) return specific;
    // Fallback: clone global values
    return allMonthlyParams.get(GLOBAL_KEY)!.map((p) => ({ ...p }));
  }, [allMonthlyParams, selectedCostCenters]);

  // Global monthly params (for projection engine, which uses global)
  const monthlyParams = allMonthlyParams.get(GLOBAL_KEY)!;

  // Arrival hypotheses state (managed by sub-component, but needed for projection)
  const [arrivalHypotheses, setArrivalHypotheses] = useState<ArrivalHypothesis[]>(initialArrivalHypotheses);
  // Temp exit hypotheses state
  const [tempExitHypotheses, setTempExitHypotheses] = useState<TempExitHypothesis[]>(initialTempExitHypotheses);
  const [tempExitCount, setTempExitCount] = useState(initialTempExitHypotheses.length);
  // Departure hypotheses state
  const [departureHypotheses, setDepartureHypotheses] = useState<DepartureHypothesis[]>(initialDepartureHypotheses);

  // Check if any selected cost center has specific rates
  const hasSpecificRates = useMemo(() => {
    return selectedCostCenters.some((cc) => cc !== GLOBAL_KEY && allMonthlyParams.has(cc));
  }, [selectedCostCenters, allMonthlyParams]);

  const updateMonthParam = useCallback((mois: number, field: keyof MonthlyParam, value: number) => {
    setAllMonthlyParams((prev) => {
      const next = new Map(prev);
      for (const cc of selectedCostCenters) {
        // Get or create params for this cost center
        let params = next.get(cc);
        if (!params) {
          // Initialize from global
          params = next.get(GLOBAL_KEY)!.map((p) => ({ ...p }));
        }
        params = params.map((p) => {
          if (p.mois === mois) return { ...p, [field]: value };
          return p;
        });
        next.set(cc, params);
      }
      return next;
    });
  }, [selectedCostCenters]);

  const setUniformRate = useCallback((rate: number) => {
    setAllMonthlyParams((prev) => {
      const next = new Map(prev);
      for (const cc of selectedCostCenters) {
        let params = next.get(cc);
        if (!params) {
          params = next.get(GLOBAL_KEY)!.map((p) => ({ ...p }));
        }
        next.set(cc, params.map((p) => ({ ...p, absenteeism_rate: rate })));
      }
      return next;
    });
  }, [selectedCostCenters]);

  const resetToGlobal = useCallback(() => {
    setAllMonthlyParams((prev) => {
      const next = new Map(prev);
      for (const cc of selectedCostCenters) {
        if (cc !== GLOBAL_KEY) {
          next.delete(cc);
        }
      }
      return next;
    });
  }, [selectedCostCenters]);

  // Turnover displayed params
  const displayedTurnoverParams = useMemo((): MonthlyTurnoverParam[] => {
    const first = selectedTurnoverCostCenters[0] || GLOBAL_KEY;
    const specific = allMonthlyTurnoverParams.get(first);
    if (specific) return specific;
    return allMonthlyTurnoverParams.get(GLOBAL_KEY)!.map((p) => ({ ...p }));
  }, [allMonthlyTurnoverParams, selectedTurnoverCostCenters]);

  const globalTurnoverParams = allMonthlyTurnoverParams.get(GLOBAL_KEY)!;

  const hasSpecificTurnoverRates = useMemo(() => {
    return selectedTurnoverCostCenters.some((cc) => cc !== GLOBAL_KEY && allMonthlyTurnoverParams.has(cc));
  }, [selectedTurnoverCostCenters, allMonthlyTurnoverParams]);

  const updateTurnoverMonthParam = useCallback((mois: number, value: number) => {
    setAllMonthlyTurnoverParams((prev) => {
      const next = new Map(prev);
      for (const cc of selectedTurnoverCostCenters) {
        let params = next.get(cc);
        if (!params) {
          params = next.get(GLOBAL_KEY)!.map((p) => ({ ...p }));
        }
        params = params.map((p) => {
          if (p.mois === mois) return { ...p, turnover_rate: value };
          return p;
        });
        next.set(cc, params);
      }
      return next;
    });
  }, [selectedTurnoverCostCenters]);

  const setUniformTurnoverRate = useCallback((rate: number) => {
    setAllMonthlyTurnoverParams((prev) => {
      const next = new Map(prev);
      for (const cc of selectedTurnoverCostCenters) {
        let params = next.get(cc);
        if (!params) {
          params = next.get(GLOBAL_KEY)!.map((p) => ({ ...p }));
        }
        next.set(cc, params.map((p) => ({ ...p, turnover_rate: rate })));
      }
      return next;
    });
  }, [selectedTurnoverCostCenters]);

  const resetTurnoverToGlobal = useCallback(() => {
    setAllMonthlyTurnoverParams((prev) => {
      const next = new Map(prev);
      for (const cc of selectedTurnoverCostCenters) {
        if (cc !== GLOBAL_KEY) {
          next.delete(cc);
        }
      }
      return next;
    });
  }, [selectedTurnoverCostCenters]);

  // Leave displayed params
  const displayedLeaveParams = useMemo((): MonthlyLeaveParam[] => {
    const first = selectedLeaveCostCenters[0] || GLOBAL_KEY;
    const specific = allMonthlyLeaveParams.get(first);
    if (specific) return specific;
    return allMonthlyLeaveParams.get(GLOBAL_KEY)!.map((p) => ({ ...p }));
  }, [allMonthlyLeaveParams, selectedLeaveCostCenters]);

  const updateLeaveMonthParam = useCallback((mois: number, value: number) => {
    setAllMonthlyLeaveParams((prev) => {
      const next = new Map(prev);
      for (const cc of selectedLeaveCostCenters) {
        let params = next.get(cc);
        if (!params) {
          params = next.get(GLOBAL_KEY)!.map((p) => ({ ...p }));
        }
        next.set(cc, params.map((p) => p.mois === mois ? { ...p, leave_rate: value } : p));
      }
      return next;
    });
  }, [selectedLeaveCostCenters]);

  const setUniformLeaveRate = useCallback((rate: number) => {
    setAllMonthlyLeaveParams((prev) => {
      const next = new Map(prev);
      for (const cc of selectedLeaveCostCenters) {
        let params = next.get(cc);
        if (!params) {
          params = next.get(GLOBAL_KEY)!.map((p) => ({ ...p }));
        }
        next.set(cc, params.map((p) => ({ ...p, leave_rate: rate })));
      }
      return next;
    });
  }, [selectedLeaveCostCenters]);

  const hasSpecificLeaveRates = useMemo(() => {
    return selectedLeaveCostCenters.some((cc) => cc !== GLOBAL_KEY && allMonthlyLeaveParams.has(cc));
  }, [selectedLeaveCostCenters, allMonthlyLeaveParams]);

  const resetLeaveToGlobal = useCallback(() => {
    setAllMonthlyLeaveParams((prev) => {
      const next = new Map(prev);
      for (const cc of selectedLeaveCostCenters) {
        if (cc !== GLOBAL_KEY) {
          next.delete(cc);
        }
      }
      return next;
    });
  }, [selectedLeaveCostCenters]);

  // Build scenario params for projection
  const scenarioParams: ScenarioParams = useMemo(() => ({
    turnover_rate: turnoverRate,
    monthly_params: monthlyParams,
    monthly_turnover_params: globalTurnoverParams,
    known_departures: [],
    arrival_hypotheses: arrivalHypotheses,
    temp_exit_hypotheses: tempExitHypotheses,
    departure_hypotheses: departureHypotheses,
  }), [turnoverRate, monthlyParams, globalTurnoverParams, arrivalHypotheses, tempExitHypotheses, departureHypotheses]);

  // Run projection (recalculates on every param change)
  const projection = useMemo(() =>
    projectHeadcount(employees, absences, scenarioParams, selectedYear, targetTotal),
    [employees, absences, scenarioParams, selectedYear, targetTotal]
  );

  // Transform for chart
  const chartData: HeadcountDataPoint[] = useMemo(() =>
    projection.map((p) => ({
      month: p.month_label,
      effectif_brut: p.effectif_brut,
      effectif_net: p.effectif_net,
      is_projection: p.is_projection,
      target: targetTotal,
    })),
    [projection, targetTotal]
  );

  // Leave rate total validation
  const leaveRateTotal = useMemo(() => {
    const globalParams = allMonthlyLeaveParams.get(GLOBAL_KEY);
    if (!globalParams) return 0;
    return Math.round(globalParams.reduce((sum, p) => sum + p.leave_rate, 0) * 10) / 10;
  }, [allMonthlyLeaveParams]);

  const leaveRateValid = leaveRateTotal === 100 || leaveRateTotal === 0;

  const handleSave = async () => {
    if (!leaveRateValid) {
      toast.error(`La somme des taux de congés doit être 100% (actuellement ${leaveRateTotal}%)`);
      return;
    }
    setSaving(true);
    try {
      // Flatten all cost center params into a single array
      const allParams: { mois: number; projected_absenteeism_rate: number; centre_cout?: string | null }[] = [];
      for (const [key, params] of allMonthlyParams) {
        for (const mp of params) {
          allParams.push({
            mois: mp.mois,
            projected_absenteeism_rate: mp.absenteeism_rate,
            centre_cout: key === GLOBAL_KEY ? null : key,
          });
        }
      }
      // Flatten all turnover cost center params
      const allTurnoverParams: { mois: number; projected_turnover_rate: number; centre_cout?: string | null }[] = [];
      for (const [key, params] of allMonthlyTurnoverParams) {
        for (const tp of params) {
          allTurnoverParams.push({
            mois: tp.mois,
            projected_turnover_rate: tp.turnover_rate,
            centre_cout: key === GLOBAL_KEY ? null : key,
          });
        }
      }
      // Flatten all leave cost center params
      const allLeaveParams: { mois: number; projected_leave_rate: number; centre_cout?: string | null }[] = [];
      for (const [key, params] of allMonthlyLeaveParams) {
        for (const lp of params) {
          allLeaveParams.push({
            mois: lp.mois,
            projected_leave_rate: lp.leave_rate,
            centre_cout: key === GLOBAL_KEY ? null : key,
          });
        }
      }
      await updateScenario(scenario.id, {
        name,
        description,
        projected_turnover_rate: turnoverRate,
        monthly_params: allParams,
        monthly_turnover_params: allTurnoverParams,
        monthly_leave_params: allLeaveParams,
      });
      toast.success("Scénario sauvegardé");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  // Summary stats from projection
  const lastMonth = projection[projection.length - 1];
  const projectedDepartures = projection.reduce((sum, p) => sum + (p.is_projection ? p.departures : 0), 0);
  const projectedArrivals = projection.reduce((sum, p) => sum + (p.is_projection ? p.arrivals : 0), 0);

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/workforce/scenarios">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="group">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="text-2xl font-bold bg-transparent border-none outline-none focus:ring-1 focus:ring-primary rounded px-1 -ml-1 w-auto"
                style={{ width: `${Math.max(name.length, 1)}ch` }}
              />
              <Pencil className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="text-muted-foreground text-sm">{description || "Scénario de projection"}</p>
          </div>
        </div>
        <Button onClick={handleSave} disabled={saving || !leaveRateValid}>
          <Save className="mr-2 h-4 w-4" />
          {saving ? "Sauvegarde..." : "Sauvegarder"}
        </Button>
      </div>

      {/* Configuration tabs */}
      <Tabs defaultValue="params">
        <TabsList>
          <TabsTrigger value="params">Variables globales</TabsTrigger>
          <TabsTrigger value="monthly">Paramètres mensuels non pris en charge CNS</TabsTrigger>
          <TabsTrigger value="turnover">Paramètres turnover mensuel</TabsTrigger>
          <TabsTrigger value="leave">Paramètres congés mensuels</TabsTrigger>
          <TabsTrigger value="arrivals">Hypothèses d&apos;arrivées</TabsTrigger>
          <TabsTrigger value="temp_exits">Sorties temporaires ({tempExitCount})</TabsTrigger>
          <TabsTrigger value="departures">Départs ({departureHypotheses.length})</TabsTrigger>
          <TabsTrigger value="detail">Détail projection</TabsTrigger>
        </TabsList>

        {/* Global params */}
        <TabsContent value="params" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Variables globales</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Nom du scénario</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Input value={description} onChange={(e) => setDescription(e.target.value)} />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Taux de turnover annuel projeté (%)</Label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="0"
                    max="30"
                    step="0.5"
                    value={turnoverRate}
                    onChange={(e) => setTurnoverRate(parseFloat(e.target.value))}
                    className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                  <span className="text-sm font-medium w-16 text-right">{turnoverRate.toFixed(1)}%</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Taux d&apos;absentéisme uniforme</Label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={uniformAbsenteeism}
                      onChange={(e) => setUniformAbsenteeism(e.target.checked)}
                      className="accent-primary"
                    />
                    Appliquer le même taux à tous les mois
                  </label>
                </div>
                {uniformAbsenteeism && (
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min="0"
                      max="30"
                      step="0.5"
                      value={monthlyParams[0]?.absenteeism_rate ?? 0}
                      onChange={(e) => setUniformRate(parseFloat(e.target.value))}
                      className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                    <span className="text-sm font-medium w-16 text-right">
                      {(monthlyParams[0]?.absenteeism_rate ?? 0).toFixed(1)}%
                    </span>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Taux de congés uniforme</Label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={uniformLeave}
                      onChange={(e) => setUniformLeave(e.target.checked)}
                      className="accent-primary"
                    />
                    Appliquer le même taux à tous les mois
                  </label>
                </div>
                {uniformLeave && (
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min="0"
                      max="30"
                      step="0.5"
                      value={displayedLeaveParams[0]?.leave_rate ?? 0}
                      onChange={(e) => setUniformLeaveRate(parseFloat(e.target.value))}
                      className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                    <span className="text-sm font-medium w-16 text-right">
                      {(displayedLeaveParams[0]?.leave_rate ?? 0).toFixed(1)}%
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Monthly params */}
        <TabsContent value="monthly">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Paramètres mensuels non pris en charge CNS — {selectedYear}
                </CardTitle>
                <div className="flex items-center gap-2">
                  {/* Multi-select cost center */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 text-xs">
                        {selectedCostCenters.length === 1 && selectedCostCenters[0] === GLOBAL_KEY
                          ? "Global"
                          : selectedCostCenters.length === 1
                            ? selectedCostCenters[0]
                            : `${selectedCostCenters.length} sélectionnés`}
                        <ChevronDown className="ml-2 h-3 w-3" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-2" align="end">
                      <div className="space-y-1 max-h-64 overflow-auto">
                        <label className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer">
                          <Checkbox
                            checked={selectedCostCenters.includes(GLOBAL_KEY)}
                            onCheckedChange={(checked) => {
                              // Global is exclusive: selecting it deselects all CCs
                              if (checked) setSelectedCostCenters([GLOBAL_KEY]);
                            }}
                          />
                          <span className="text-sm font-medium">Global (défaut)</span>
                        </label>
                        <div className="border-t my-1" />
                        {comboboxOptions.centres_cout.map((cc) => (
                          <label key={cc} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer">
                            <Checkbox
                              checked={selectedCostCenters.includes(cc)}
                              onCheckedChange={(checked) => {
                                setSelectedCostCenters((prev) => {
                                  // Selecting a CC removes Global from selection
                                  const withoutGlobal = prev.filter((c) => c !== GLOBAL_KEY);
                                  if (checked) {
                                    return [...withoutGlobal, cc];
                                  }
                                  const result = withoutGlobal.filter((c) => c !== cc);
                                  // If nothing left, fallback to Global
                                  return result.length > 0 ? result : [GLOBAL_KEY];
                                });
                              }}
                            />
                            <span className="text-sm">{cc}</span>
                            {allMonthlyParams.has(cc) && (
                              <Badge variant="secondary" className="text-[10px] ml-auto">Spécifique</Badge>
                            )}
                          </label>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                  {/* Reset to global button */}
                  {hasSpecificRates && (
                    <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={resetToGlobal}>
                      <RotateCcw className="mr-1 h-3 w-3" />
                      Réinitialiser vers global
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Mois</TableHead>
                      <TableHead className="text-xs">Absentéisme (%)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayedParams.map((mp) => (
                      <TableRow key={mp.mois}>
                        <TableCell className="font-medium text-sm">{FRENCH_MONTHS_SHORT[mp.mois]}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <input
                              type="range"
                              min="0"
                              max="30"
                              step="0.5"
                              value={mp.absenteeism_rate}
                              onChange={(e) => updateMonthParam(mp.mois, "absenteeism_rate", parseFloat(e.target.value))}
                              disabled={uniformAbsenteeism}
                              className="w-24 h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                            />
                            <Input
                              type="number"
                              value={mp.absenteeism_rate}
                              onChange={(e) => updateMonthParam(mp.mois, "absenteeism_rate", parseFloat(e.target.value) || 0)}
                              disabled={uniformAbsenteeism}
                              className="w-20 h-7 text-xs"
                              step="0.5"
                              min="0"
                              max="100"
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Monthly turnover params */}
        <TabsContent value="turnover">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Repeat className="h-4 w-4" />
                  Paramètres turnover mensuel — {selectedYear}
                </CardTitle>
                <div className="flex items-center gap-2">
                  {/* Uniform toggle */}
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={uniformTurnover}
                      onChange={(e) => setUniformTurnover(e.target.checked)}
                      className="accent-primary"
                    />
                    Même taux tous les mois
                  </label>
                  {/* Multi-select cost center */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 text-xs">
                        {selectedTurnoverCostCenters.length === 1 && selectedTurnoverCostCenters[0] === GLOBAL_KEY
                          ? "Global"
                          : selectedTurnoverCostCenters.length === 1
                            ? selectedTurnoverCostCenters[0]
                            : `${selectedTurnoverCostCenters.length} sélectionnés`}
                        <ChevronDown className="ml-2 h-3 w-3" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-2" align="end">
                      <div className="space-y-1 max-h-64 overflow-auto">
                        <label className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer">
                          <Checkbox
                            checked={selectedTurnoverCostCenters.includes(GLOBAL_KEY)}
                            onCheckedChange={(checked) => {
                              if (checked) setSelectedTurnoverCostCenters([GLOBAL_KEY]);
                            }}
                          />
                          <span className="text-sm font-medium">Global (défaut)</span>
                        </label>
                        <div className="border-t my-1" />
                        {comboboxOptions.centres_cout.map((cc) => (
                          <label key={cc} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer">
                            <Checkbox
                              checked={selectedTurnoverCostCenters.includes(cc)}
                              onCheckedChange={(checked) => {
                                setSelectedTurnoverCostCenters((prev) => {
                                  const withoutGlobal = prev.filter((c) => c !== GLOBAL_KEY);
                                  if (checked) {
                                    return [...withoutGlobal, cc];
                                  }
                                  const result = withoutGlobal.filter((c) => c !== cc);
                                  return result.length > 0 ? result : [GLOBAL_KEY];
                                });
                              }}
                            />
                            <span className="text-sm">{cc}</span>
                            {allMonthlyTurnoverParams.has(cc) && (
                              <Badge variant="secondary" className="text-[10px] ml-auto">Spécifique</Badge>
                            )}
                          </label>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                  {hasSpecificTurnoverRates && (
                    <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={resetTurnoverToGlobal}>
                      <RotateCcw className="mr-1 h-3 w-3" />
                      Réinitialiser vers global
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {uniformTurnover && (
                <div className="flex items-center gap-4 mb-4">
                  <input
                    type="range"
                    min="0"
                    max="30"
                    step="0.5"
                    value={displayedTurnoverParams[0]?.turnover_rate || turnoverRate}
                    onChange={(e) => setUniformTurnoverRate(parseFloat(e.target.value))}
                    className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                  <span className="text-sm font-medium w-16 text-right">
                    {(displayedTurnoverParams[0]?.turnover_rate || turnoverRate).toFixed(1)}%
                  </span>
                </div>
              )}
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Mois</TableHead>
                      <TableHead className="text-xs">Taux turnover annuel (%)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayedTurnoverParams.map((tp) => (
                      <TableRow key={tp.mois}>
                        <TableCell className="font-medium text-sm">{FRENCH_MONTHS_SHORT[tp.mois]}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <input
                              type="range"
                              min="0"
                              max="30"
                              step="0.5"
                              value={tp.turnover_rate}
                              onChange={(e) => updateTurnoverMonthParam(tp.mois, parseFloat(e.target.value))}
                              disabled={uniformTurnover}
                              className="w-24 h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                            />
                            <Input
                              type="number"
                              value={tp.turnover_rate}
                              onChange={(e) => updateTurnoverMonthParam(tp.mois, parseFloat(e.target.value) || 0)}
                              disabled={uniformTurnover}
                              className="w-20 h-7 text-xs"
                              step="0.5"
                              min="0"
                              max="100"
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Leave params */}
        <TabsContent value="leave">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Paramètres congés mensuels — {selectedYear}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 text-xs">
                        {selectedLeaveCostCenters.length === 1 && selectedLeaveCostCenters[0] === GLOBAL_KEY
                          ? "Global"
                          : selectedLeaveCostCenters.length === 1
                            ? selectedLeaveCostCenters[0]
                            : `${selectedLeaveCostCenters.length} sélectionnés`}
                        <ChevronDown className="ml-2 h-3 w-3" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-2" align="end">
                      <div className="space-y-1 max-h-64 overflow-auto">
                        <label className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer">
                          <Checkbox
                            checked={selectedLeaveCostCenters.includes(GLOBAL_KEY)}
                            onCheckedChange={(checked) => {
                              if (checked) setSelectedLeaveCostCenters([GLOBAL_KEY]);
                            }}
                          />
                          <span className="text-sm font-medium">Global (défaut)</span>
                        </label>
                        <div className="border-t my-1" />
                        {comboboxOptions.centres_cout.map((cc) => (
                          <label key={cc} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer">
                            <Checkbox
                              checked={selectedLeaveCostCenters.includes(cc)}
                              onCheckedChange={(checked) => {
                                setSelectedLeaveCostCenters((prev) => {
                                  const withoutGlobal = prev.filter((c) => c !== GLOBAL_KEY);
                                  if (checked) return [...withoutGlobal, cc];
                                  const result = withoutGlobal.filter((c) => c !== cc);
                                  return result.length > 0 ? result : [GLOBAL_KEY];
                                });
                              }}
                            />
                            <span className="text-sm">{cc}</span>
                            {allMonthlyLeaveParams.has(cc) && (
                              <Badge variant="secondary" className="text-[10px] ml-auto">Spécifique</Badge>
                            )}
                          </label>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                  {hasSpecificLeaveRates && (
                    <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={resetLeaveToGlobal}>
                      <RotateCcw className="mr-1 h-3 w-3" />
                      Réinitialiser vers global
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Mois</TableHead>
                      <TableHead className="text-xs">Congés (%)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayedLeaveParams.map((lp) => (
                      <TableRow key={lp.mois}>
                        <TableCell className="font-medium text-sm">{FRENCH_MONTHS_SHORT[lp.mois]}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <input
                              type="range"
                              min="0"
                              max="30"
                              step="0.5"
                              value={lp.leave_rate}
                              onChange={(e) => updateLeaveMonthParam(lp.mois, parseFloat(e.target.value))}
                              disabled={uniformLeave}
                              className="w-24 h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                            />
                            <Input
                              type="number"
                              value={lp.leave_rate}
                              onChange={(e) => updateLeaveMonthParam(lp.mois, parseFloat(e.target.value) || 0)}
                              disabled={uniformLeave}
                              className="w-20 h-7 text-xs"
                              step="0.5"
                              min="0"
                              max="100"
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className={`mt-4 flex items-center justify-between rounded-lg border px-4 py-2 ${leaveRateValid ? "border-border" : "border-red-400 bg-red-50"}`}>
                <span className="text-sm font-medium">
                  Total : {leaveRateTotal.toFixed(1)}%
                </span>
                <span className={`text-sm ${leaveRateValid ? "text-muted-foreground" : "text-red-600 font-medium"}`}>
                  {leaveRateTotal === 100
                    ? "Répartition complète"
                    : leaveRateTotal === 0
                      ? "Aucun congé configuré"
                      : `Reste ${(100 - leaveRateTotal).toFixed(1)}% à attribuer`}
                </span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Arrival hypotheses */}
        <TabsContent value="arrivals">
          <ArrivalHypothesesTab
            scenarioId={scenario.id}
            hypotheses={arrivalHypotheses}
            comboboxOptions={comboboxOptions}
            selectedYear={selectedYear}
          />
        </TabsContent>

        {/* Temporary exits */}
        <TabsContent value="temp_exits">
          <TemporaryExitsTab
            scenarioId={scenario.id}
            hypotheses={tempExitHypotheses}
            comboboxOptions={comboboxOptions}
            selectedYear={selectedYear}
            onCountChange={setTempExitCount}
          />
        </TabsContent>

        {/* Departures */}
        <TabsContent value="departures">
          <DepartureHypothesesTab
            scenarioId={scenario.id}
            hypotheses={departureHypotheses}
            comboboxOptions={comboboxOptions}
            employees={employees}
            selectedYear={selectedYear}
          />
        </TabsContent>

        {/* Projection detail */}
        <TabsContent value="detail">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Détail mensuel de la projection</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Mois</TableHead>
                      <TableHead className="text-xs">Type</TableHead>
                      <TableHead className="text-xs">Eff. brut</TableHead>
                      <TableHead className="text-xs">Eff. net</TableHead>
                      <TableHead className="text-xs">Départs</TableHead>
                      <TableHead className="text-xs">Turnover</TableHead>
                      <TableHead className="text-xs">Arrivées</TableHead>
                      <TableHead className="text-xs">Absentéisme</TableHead>
                      {targetTotal && <TableHead className="text-xs">Gap</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {projection.map((p) => {
                      const gap = targetTotal ? p.effectif_net - targetTotal : null;
                      return (
                        <TableRow key={p.month} className={p.is_projection ? "bg-muted/30" : ""}>
                          <TableCell className="font-medium text-sm">{p.month_label}</TableCell>
                          <TableCell>
                            <Badge variant={p.is_projection ? "outline" : "secondary"} className="text-xs">
                              {p.is_projection ? "Projection" : "Réel"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm font-medium">{p.effectif_brut}</TableCell>
                          <TableCell className="text-sm">{p.effectif_net}</TableCell>
                          <TableCell className="text-sm text-red-600">{p.departures > 0 ? `-${p.departures}` : "-"}</TableCell>
                          <TableCell className="text-sm text-orange-600">{p.turnover_losses > 0 ? `-${p.turnover_losses}` : "-"}</TableCell>
                          <TableCell className="text-sm text-emerald-600">{p.arrivals > 0 ? `+${p.arrivals}` : "-"}</TableCell>
                          <TableCell className="text-sm">{p.absenteeism_rate.toFixed(1)}%</TableCell>
                          {targetTotal && (
                            <TableCell className={`text-sm font-medium ${gap !== null && gap >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                              {gap !== null ? (gap >= 0 ? `+${gap}` : gap) : "-"}
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
