"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Save, ArrowLeft, Pencil, RefreshCw } from "lucide-react";
import { updateTargetScenario, computeProjectionByDepot } from "../actions";
import { toast } from "sonner";
import Link from "next/link";
import { FRENCH_MONTHS_SHORT } from "@/lib/constants";

interface TargetValue {
  mois: number;
  depot: string;
  target_etp: number;
}

interface CostCenter {
  name: string;
  depots: string[];
}

interface ProjectionScenario {
  id: string;
  name: string;
}

interface Props {
  scenario: { id: string; name: string; description: string };
  values: TargetValue[];
  costCenters: CostCenter[];
  projectionScenarios: ProjectionScenario[];
}

export function TargetScenarioEditorClient({ scenario, values: initialValues, costCenters, projectionScenarios }: Props) {
  const [name, setName] = useState(scenario.name);
  const [description, setDescription] = useState(scenario.description);
  const [saving, setSaving] = useState(false);
  const [prefilling, setPrefilling] = useState(false);
  const [prefillOpen, setPrefillOpen] = useState(false);
  const [selectedProjScenarios, setSelectedProjScenarios] = useState<Set<string>>(new Set());
  const [prefillTurnoverSrc, setPrefillTurnoverSrc] = useState<string | null>(null);
  const [prefillAbsSrc, setPrefillAbsSrc] = useState<string | null>(null);
  const [prefillLeaveSrc, setPrefillLeaveSrc] = useState<string | null>(null);

  // Build a Map<"depot|||mois", target_etp> for quick lookup and editing
  const SEP = "|||";
  const [valuesMap, setValuesMap] = useState<Map<string, number>>(() => {
    const map = new Map<string, number>();
    initialValues.forEach((v) => {
      map.set(`${v.depot}${SEP}${v.mois}`, v.target_etp);
    });
    return map;
  });

  const getValue = (depot: string, mois: number): number => {
    return valuesMap.get(`${depot}${SEP}${mois}`) ?? 0;
  };

  const setValue = (depot: string, mois: number, value: number) => {
    setValuesMap((prev) => {
      const next = new Map(prev);
      next.set(`${depot}${SEP}${mois}`, value);
      return next;
    });
  };

  // Consolidated total for a cost center
  const getCcTotal = (cc: CostCenter, mois: number): number => {
    return cc.depots.reduce((sum, depot) => sum + getValue(depot, mois), 0);
  };

  // Grand total across all unique depots (avoid double-counting depots in multiple CCs)
  const getGrandTotal = (mois: number): number => {
    const counted = new Set<string>();
    let total = 0;
    for (const cc of costCenters) {
      for (const depot of cc.depots) {
        if (!counted.has(depot)) {
          counted.add(depot);
          total += getValue(depot, mois);
        }
      }
    }
    return total;
  };

  const toggleProjScenario = (id: string) => {
    setSelectedProjScenarios((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (prefillTurnoverSrc === id) setPrefillTurnoverSrc(next.size > 0 ? Array.from(next)[0] : null);
        if (prefillAbsSrc === id) setPrefillAbsSrc(next.size > 0 ? Array.from(next)[0] : null);
        if (prefillLeaveSrc === id) setPrefillLeaveSrc(next.size > 0 ? Array.from(next)[0] : null);
      } else {
        next.add(id);
        if (!prefillTurnoverSrc) setPrefillTurnoverSrc(id);
        if (!prefillAbsSrc) setPrefillAbsSrc(id);
        if (!prefillLeaveSrc) setPrefillLeaveSrc(id);
      }
      return next;
    });
  };

  const handlePrefill = async () => {
    if (selectedProjScenarios.size === 0) {
      toast.error("Sélectionnez au moins un scénario de prévision");
      return;
    }
    setPrefilling(true);
    try {
      const results = await computeProjectionByDepot({
        scenarioIds: Array.from(selectedProjScenarios),
        turnoverSrcId: prefillTurnoverSrc,
        absSrcId: prefillAbsSrc,
        leaveSrcId: prefillLeaveSrc,
        year: new Date().getFullYear(),
      });
      // Replace entire map with new values
      const next = new Map<string, number>();
      results.forEach((r) => {
        next.set(`${r.depot}${SEP}${r.mois}`, r.etp);
      });
      setValuesMap(next);
      setPrefillOpen(false);
      toast.success(`${results.length} valeurs pré-remplies`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur");
    } finally {
      setPrefilling(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const allValues: { mois: number; depot: string; target_etp: number }[] = [];
      for (const [key, value] of valuesMap) {
        if (value <= 0) continue;
        const sepIdx = key.lastIndexOf(SEP);
        const depot = key.substring(0, sepIdx);
        const mois = parseInt(key.substring(sepIdx + SEP.length));
        allValues.push({ mois, depot, target_etp: value });
      }
      await updateTargetScenario(scenario.id, {
        name,
        description,
        values: allValues,
      });
      toast.success("Scénario de besoins sauvegardé");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  const defaultTab = costCenters.length > 0 ? costCenters[0].name : "";

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/workforce/targets">
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
            <p className="text-muted-foreground text-sm">{description || "Scénario de besoins cibles"}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Popover open={prefillOpen} onOpenChange={setPrefillOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline">
                <RefreshCw className="mr-2 h-4 w-4" />
                Pré-remplir
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[350px]" align="end">
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium">Pré-remplir depuis les scénarios</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Sélectionnez les scénarios de prévision. Les cibles seront pré-remplies avec l&apos;effectif disponible après congés.
                  </p>
                </div>
                <div className="space-y-1 max-h-[300px] overflow-y-auto">
                  {projectionScenarios.map((sc) => {
                    const isSelected = selectedProjScenarios.has(sc.id);
                    return (
                      <div
                        key={sc.id}
                        className={`rounded-md border p-2 transition-colors ${isSelected ? "border-primary/30 bg-primary/5" : "border-transparent"}`}
                      >
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleProjScenario(sc.id)}
                          />
                          <span className="text-sm font-medium">{sc.name}</span>
                        </div>
                        {isSelected && (
                          <div className="flex gap-3 mt-2 ml-6">
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input type="radio" name="pf_turnover" checked={prefillTurnoverSrc === sc.id} onChange={() => setPrefillTurnoverSrc(sc.id)} className="h-3 w-3 accent-primary" />
                              <span className="text-xs text-muted-foreground">Turnover</span>
                            </label>
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input type="radio" name="pf_abs" checked={prefillAbsSrc === sc.id} onChange={() => setPrefillAbsSrc(sc.id)} className="h-3 w-3 accent-primary" />
                              <span className="text-xs text-muted-foreground">Absentéisme</span>
                            </label>
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input type="radio" name="pf_leave" checked={prefillLeaveSrc === sc.id} onChange={() => setPrefillLeaveSrc(sc.id)} className="h-3 w-3 accent-primary" />
                              <span className="text-xs text-muted-foreground">Congés</span>
                            </label>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <Button onClick={handlePrefill} disabled={prefilling || selectedProjScenarios.size === 0} className="w-full" size="sm">
                  {prefilling ? "Calcul en cours..." : "Appliquer"}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? "Sauvegarde..." : "Sauvegarder"}
          </Button>
        </div>
      </div>


{/* Grand total card */}
      <Card >
        <CardHeader>
          <CardTitle className="text-base">Total général — Cible ETP</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs w-48"></TableHead>
                  {Array.from({ length: 12 }, (_, i) => (
                    <TableHead key={i + 1} className="text-xs text-center min-w-[70px]">
                      {FRENCH_MONTHS_SHORT[i + 1]}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="font-bold">
                  <TableCell className="text-sm">Total</TableCell>
                  {Array.from({ length: 12 }, (_, i) => (
                    <TableCell key={i + 1} className="text-sm text-center">
                      {Math.round(getGrandTotal(i + 1) * 10) / 10 || "—"}
                    </TableCell>
                  ))}
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Tabs by cost center */}
      {costCenters.length > 0 && (
        <Tabs defaultValue={defaultTab}>
          <TabsList className="flex-wrap h-auto gap-1">
            {costCenters.map((cc) => (
              <TabsTrigger key={cc.name} value={cc.name} className="text-xs">
                {cc.name}
              </TabsTrigger>
            ))}
          </TabsList>

          {costCenters.map((cc) => (
            <TabsContent key={cc.name} value={cc.name} className="space-y-4">
              {/* CC consolidated total */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Total {cc.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs w-48"></TableHead>
                          {Array.from({ length: 12 }, (_, i) => (
                            <TableHead key={i + 1} className="text-xs text-center min-w-[70px]">
                              {FRENCH_MONTHS_SHORT[i + 1]}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow className="font-semibold bg-muted/30">
                          <TableCell className="text-sm">Total CC</TableCell>
                          {Array.from({ length: 12 }, (_, i) => (
                            <TableCell key={i + 1} className="text-sm text-center">
                              {Math.round(getCcTotal(cc, i + 1) * 10) / 10 || "—"}
                            </TableCell>
                          ))}
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              {/* Per-depot tables */}
              {cc.depots.map((depot) => (
                <Card key={depot}>
                  <CardHeader>
                    <CardTitle className="text-sm">{depot}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs w-48"></TableHead>
                            {Array.from({ length: 12 }, (_, i) => (
                              <TableHead key={i + 1} className="text-xs text-center min-w-[70px]">
                                {FRENCH_MONTHS_SHORT[i + 1]}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          <TableRow>
                            <TableCell className="text-sm font-medium">Cible ETP</TableCell>
                            {Array.from({ length: 12 }, (_, i) => {
                              const mois = i + 1;
                              return (
                                <TableCell key={mois} className="p-1">
                                  <Input
                                    type="number"
                                    value={getValue(depot, mois) || ""}
                                    onChange={(e) => setValue(depot, mois, parseFloat(e.target.value) || 0)}
                                    className="w-16 h-7 text-xs text-center"
                                    min="0"
                                    step="0.5"
                                  />
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>
          ))}
        </Tabs>
      )}
    </>
  );
}
