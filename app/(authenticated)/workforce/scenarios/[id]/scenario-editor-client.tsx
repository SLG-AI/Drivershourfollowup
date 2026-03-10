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
import { HeadcountEvolutionChart, type HeadcountDataPoint } from "@/components/workforce/headcount-evolution-chart";
import { projectHeadcount, type Employee, type AbsenceRecord, type ScenarioParams, type MonthlyParam } from "@/lib/utils/wp-calculations";
import { updateScenario, autoPopulateDepartures } from "../actions";
import { FRENCH_MONTHS_SHORT } from "@/lib/constants";
import { Save, RefreshCw, ArrowLeft, TrendingDown, Calendar } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

interface DbMonthlyParam {
  id: string;
  scenario_id: string;
  mois: number;
  projected_absenteeism_rate: number;
  planned_arrivals: number;
  planned_arrivals_bus: number;
  planned_arrivals_cam: number;
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

  // Monthly params state
  const [monthlyParams, setMonthlyParams] = useState<MonthlyParam[]>(() => {
    const params: MonthlyParam[] = [];
    for (let m = 1; m <= 12; m++) {
      const existing = initialMonthlyParams.find((p) => p.mois === m);
      params.push({
        mois: m,
        absenteeism_rate: existing ? Number(existing.projected_absenteeism_rate) : 5,
        planned_arrivals: existing ? Number(existing.planned_arrivals) : 0,
        planned_arrivals_bus: existing ? Number(existing.planned_arrivals_bus) : 0,
        planned_arrivals_cam: existing ? Number(existing.planned_arrivals_cam) : 0,
      });
    }
    return params;
  });

  const updateMonthParam = useCallback((mois: number, field: keyof MonthlyParam, value: number) => {
    setMonthlyParams((prev) =>
      prev.map((p) => {
        if (p.mois === mois) return { ...p, [field]: value };
        return p;
      })
    );
  }, []);

  const setUniformRate = useCallback((rate: number) => {
    setMonthlyParams((prev) =>
      prev.map((p) => ({ ...p, absenteeism_rate: rate }))
    );
  }, []);

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
  }), [turnoverRate, monthlyParams, departures]);

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
      await updateScenario(scenario.id, {
        name,
        description,
        projected_turnover_rate: turnoverRate,
        monthly_params: monthlyParams.map((mp) => ({
          mois: mp.mois,
          projected_absenteeism_rate: mp.absenteeism_rate,
          planned_arrivals: mp.planned_arrivals,
          planned_arrivals_bus: mp.planned_arrivals_bus,
          planned_arrivals_cam: mp.planned_arrivals_cam,
        })),
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
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Paramètres mensuels — {selectedYear}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Mois</TableHead>
                      <TableHead className="text-xs">Absentéisme (%)</TableHead>
                      <TableHead className="text-xs">Arrivées totales</TableHead>
                      <TableHead className="text-xs">Arrivées BUS</TableHead>
                      <TableHead className="text-xs">Arrivées CAM</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {monthlyParams.map((mp) => (
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
                        <TableCell>
                          <Input
                            type="number"
                            value={mp.planned_arrivals}
                            onChange={(e) => updateMonthParam(mp.mois, "planned_arrivals", parseInt(e.target.value) || 0)}
                            className="w-20 h-7 text-xs"
                            min="0"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={mp.planned_arrivals_bus}
                            onChange={(e) => updateMonthParam(mp.mois, "planned_arrivals_bus", parseInt(e.target.value) || 0)}
                            className="w-20 h-7 text-xs"
                            min="0"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={mp.planned_arrivals_cam}
                            onChange={(e) => updateMonthParam(mp.mois, "planned_arrivals_cam", parseInt(e.target.value) || 0)}
                            className="w-20 h-7 text-xs"
                            min="0"
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
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
