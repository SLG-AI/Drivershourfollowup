"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
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
import { projectHeadcount, type Employee, type AbsenceRecord, type ScenarioParams, type MonthlyParam, type ArrivalHypothesis } from "@/lib/utils/wp-calculations";
import { updateScenario, autoPopulateDepartures } from "../actions";
import { ArrivalHypothesesTab } from "./arrival-hypotheses-tab";
import { FRENCH_MONTHS_SHORT } from "@/lib/constants";
import { Save, RefreshCw, ArrowLeft, TrendingDown, Calendar, ChevronDown, RotateCcw } from "lucide-react";
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

interface DbDeparture {
  id: string;
  scenario_id: string;
  code_salarie: string | null;
  departure_type: string;
  departure_month: number;
  departure_year: number;
  return_month: number | null;
  return_year: number | null;
  vehicle_type: string | null;
  depot: string | null;
  is_from_data: boolean;
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
  departures: DbDeparture[];
  arrivalHypotheses: ArrivalHypothesis[];
  comboboxOptions: ComboboxOptions;
  employees: Employee[];
  absences: AbsenceRecord[];
  selectedYear: number;
  targetTotal?: number;
}

const DEPARTURE_TYPE_LABELS: Record<string, string> = {
  retirement: "Retraite",
  end_contract: "Fin de contrat",
  turnover: "Turnover",
  temp_exit_parental: "Congé parental",
  temp_exit_maternity: "Maternité",
  temp_exit_other: "Sortie temp. autre",
};

export function ScenarioEditorClient({
  scenario,
  monthlyParams: initialMonthlyParams,
  departures,
  arrivalHypotheses: initialArrivalHypotheses,
  comboboxOptions,
  employees,
  absences,
  selectedYear,
  targetTotal,
}: Props) {
  const router = useRouter();

  // Editable state
  const [name, setName] = useState(scenario.name);
  const [description, setDescription] = useState(scenario.description || "");
  const [turnoverRate, setTurnoverRate] = useState(Number(scenario.projected_turnover_rate));
  const [uniformAbsenteeism, setUniformAbsenteeism] = useState(false);
  const [saving, setSaving] = useState(false);
  const [populating, setPopulating] = useState(false);

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
          absenteeism_rate: existing ? Number(existing.projected_absenteeism_rate) : 5,
        });
      }
      map.set(key, params);
    }

    // Ensure global always exists
    if (!map.has(GLOBAL_KEY)) {
      const params: MonthlyParam[] = [];
      for (let m = 1; m <= 12; m++) {
        params.push({ mois: m, absenteeism_rate: 5 });
      }
      map.set(GLOBAL_KEY, params);
    }

    return map;
  });

  // Selected cost centers in the multi-select (for editing)
  const [selectedCostCenters, setSelectedCostCenters] = useState<string[]>([GLOBAL_KEY]);

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

  // Build scenario params for projection
  const scenarioParams: ScenarioParams = useMemo(() => ({
    turnover_rate: turnoverRate,
    monthly_params: monthlyParams,
    known_departures: departures.map((d) => ({
      code_salarie: d.code_salarie,
      departure_type: d.departure_type,
      departure_month: d.departure_month,
      departure_year: d.departure_year,
      return_month: d.return_month,
      return_year: d.return_year,
      vehicle_type: d.vehicle_type,
      is_from_data: d.is_from_data,
    })),
    arrival_hypotheses: arrivalHypotheses,
  }), [turnoverRate, monthlyParams, departures, arrivalHypotheses]);

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

  const handleSave = async () => {
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
      await updateScenario(scenario.id, {
        name,
        description,
        projected_turnover_rate: turnoverRate,
        monthly_params: allParams,
      });
      toast.success("Scénario sauvegardé");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  const handleAutoPopulate = async () => {
    setPopulating(true);
    try {
      const result = await autoPopulateDepartures(scenario.id, selectedYear);
      toast.success(`${result.count} départ(s) identifié(s) depuis les données`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur");
    } finally {
      setPopulating(false);
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
          <div>
            <h1 className="text-2xl font-bold">{name}</h1>
            <p className="text-muted-foreground text-sm">{description || "Scénario de projection"}</p>
          </div>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          <Save className="mr-2 h-4 w-4" />
          {saving ? "Sauvegarde..." : "Sauvegarder"}
        </Button>
      </div>

      {/* Projection chart */}
      <HeadcountEvolutionChart data={chartData} title={`Projection ${selectedYear} — ${name}`} />

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Effectif fin d&apos;année</p>
            <p className="text-xl font-bold">{lastMonth?.effectif_brut || "-"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Départs projetés</p>
            <p className="text-xl font-bold text-red-600">{projectedDepartures}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Arrivées prévues</p>
            <p className="text-xl font-bold text-emerald-600">{projectedArrivals}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Gap vs cible</p>
            <p className={`text-xl font-bold ${targetTotal ? (lastMonth && lastMonth.effectif_net >= targetTotal ? "text-emerald-600" : "text-red-600") : ""}`}>
              {targetTotal && lastMonth ? lastMonth.effectif_net - targetTotal : "-"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Configuration tabs */}
      <Tabs defaultValue="params">
        <TabsList>
          <TabsTrigger value="params">Variables globales</TabsTrigger>
          <TabsTrigger value="monthly">Paramètres mensuels</TabsTrigger>
          <TabsTrigger value="arrivals">Hypothèses d&apos;arrivées</TabsTrigger>
          <TabsTrigger value="departures">Départs ({departures.length})</TabsTrigger>
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
                      value={monthlyParams[0]?.absenteeism_rate || 5}
                      onChange={(e) => setUniformRate(parseFloat(e.target.value))}
                      className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                    <span className="text-sm font-medium w-16 text-right">
                      {(monthlyParams[0]?.absenteeism_rate || 5).toFixed(1)}%
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
                  Paramètres mensuels — {selectedYear}
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

        {/* Arrival hypotheses */}
        <TabsContent value="arrivals">
          <ArrivalHypothesesTab
            scenarioId={scenario.id}
            hypotheses={arrivalHypotheses}
            comboboxOptions={comboboxOptions}
            selectedYear={selectedYear}
          />
        </TabsContent>

        {/* Departures */}
        <TabsContent value="departures">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingDown className="h-4 w-4" />
                  Départs connus
                </CardTitle>
                <Button variant="outline" size="sm" onClick={handleAutoPopulate} disabled={populating}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${populating ? "animate-spin" : ""}`} />
                  {populating ? "Détection..." : "Détecter depuis les données"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {departures.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Aucun départ enregistré. Cliquez sur &quot;Détecter depuis les données&quot; pour auto-remplir.
                </p>
              ) : (
                <div className="max-h-96 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Code salarié</TableHead>
                        <TableHead className="text-xs">Type</TableHead>
                        <TableHead className="text-xs">Véhicule</TableHead>
                        <TableHead className="text-xs">Mois départ</TableHead>
                        <TableHead className="text-xs">Retour</TableHead>
                        <TableHead className="text-xs">Source</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {departures.map((d) => (
                        <TableRow key={d.id}>
                          <TableCell className="text-sm font-medium">{d.code_salarie || "-"}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">
                              {DEPARTURE_TYPE_LABELS[d.departure_type] || d.departure_type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">{d.vehicle_type || "-"}</TableCell>
                          <TableCell className="text-sm">
                            {FRENCH_MONTHS_SHORT[d.departure_month]} {d.departure_year}
                          </TableCell>
                          <TableCell className="text-sm">
                            {d.return_month ? `${FRENCH_MONTHS_SHORT[d.return_month]} ${d.return_year}` : "-"}
                          </TableCell>
                          <TableCell>
                            <Badge variant={d.is_from_data ? "secondary" : "outline"} className="text-xs">
                              {d.is_from_data ? "Données" : "Manuel"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
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
