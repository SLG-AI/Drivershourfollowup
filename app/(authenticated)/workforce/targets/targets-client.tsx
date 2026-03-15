"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Save, Plus, Trash2, Target, TrendingUp, TrendingDown } from "lucide-react";
import { upsertTargets } from "./actions";
import { toast } from "sonner";

interface TargetRow {
  vehicle_type: string;
  depot: string;
  centre_cout: string;
  work_time: string;
  target_headcount: number;
  target_etp: number | null;
}

interface CurrentCount {
  vehicle_type: string;
  depot: string;
  centre_cout: string;
  work_time: string;
  headcount: number;
  etp: number;
}

interface Props {
  initialTargets: TargetRow[];
  depots: string[];
  centres_cout: string[];
  currentCounts: CurrentCount[];
}

const WORK_TIME_LABELS: Record<string, string> = {
  full_time: "Temps plein",
  part_time: "Temps partiel",
};

export function TargetsClient({ initialTargets, depots, centres_cout, currentCounts }: Props) {
  const router = useRouter();
  const [targets, setTargets] = useState<TargetRow[]>(
    initialTargets.length > 0
      ? initialTargets
      : [
          { vehicle_type: "", depot: "", centre_cout: "", work_time: "100", target_headcount: 0, target_etp: null },
          { vehicle_type: "", depot: "", centre_cout: "", work_time: "100", target_headcount: 0, target_etp: null },
          { vehicle_type: "", depot: "", centre_cout: "", work_time: "100", target_headcount: 0, target_etp: null },
          { vehicle_type: "", depot: "", centre_cout: "", work_time: "100", target_headcount: 0, target_etp: null },
        ]
  );
  const [saving, setSaving] = useState(false);

  const addRow = () => {
    setTargets([...targets, { vehicle_type: "", depot: "", centre_cout: "", work_time: "100", target_headcount: 0, target_etp: null }]);
  };

  const removeRow = (index: number) => {
    setTargets(targets.filter((_, i) => i !== index));
  };

  const updateRow = (index: number, field: keyof TargetRow, value: string | number | null) => {
    setTargets(targets.map((t, i) => (i === index ? { ...t, [field]: value } : t)));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await upsertTargets(targets);
      toast.success(`${result.count} cible(s) sauvegardée(s)`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  // Compute gap for each target row
  const getCurrentEtp = (cc: string, depot: string) => {
    return Math.round(currentCounts
      .filter((c) => {
        if (cc && c.centre_cout !== cc) return false;
        if (depot && c.depot !== depot) return false;
        return true;
      })
      .reduce((sum, c) => sum + c.etp, 0) * 10) / 10;
  };

  // Summary
  const totalTarget = targets.reduce((sum, t) => sum + t.target_headcount, 0);
  const totalCurrent = useMemo(() => {
    // Sum unique active employees
    const counted = new Set<string>();
    let total = 0;
    targets.forEach((t) => {
      const key = `${t.centre_cout}|${t.depot}`;
      if (!counted.has(key)) {
        counted.add(key);
        total += getCurrentEtp(t.centre_cout, t.depot);
      }
    });
    return total;
  }, [targets, currentCounts]);
  const totalGap = totalCurrent - totalTarget;

  return (
    <>
      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Cible totale</p>
                <p className="mt-1 text-2xl font-bold">{totalTarget}</p>
              </div>
              <div className="rounded-lg p-2 bg-blue-50">
                <Target className="h-5 w-5 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Effectif actuel</p>
                <p className="mt-1 text-2xl font-bold">{totalCurrent}</p>
              </div>
              <div className="rounded-lg p-2 bg-indigo-50">
                <TrendingUp className="h-5 w-5 text-indigo-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Gap global</p>
                <p className={`mt-1 text-2xl font-bold ${totalGap >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {totalGap >= 0 ? `+${totalGap}` : totalGap}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {totalGap >= 0 ? "Surplus" : "Déficit"}
                </p>
              </div>
              <div className={`rounded-lg p-2 ${totalGap >= 0 ? "bg-emerald-50" : "bg-red-50"}`}>
                {totalGap >= 0
                  ? <TrendingUp className="h-5 w-5 text-emerald-600" />
                  : <TrendingDown className="h-5 w-5 text-red-600" />
                }
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Targets table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Configuration des cibles</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={addRow}>
                <Plus className="mr-2 h-4 w-4" />
                Ajouter une ligne
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? "Sauvegarde..." : "Sauvegarder"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Cost center</TableHead>
                <TableHead className="text-xs">Dépôt</TableHead>
                <TableHead className="text-xs">Taux occupation (%)</TableHead>
                <TableHead className="text-xs">Cible effectif</TableHead>
                <TableHead className="text-xs">Actuel</TableHead>
                <TableHead className="text-xs">Gap</TableHead>
                <TableHead className="text-xs w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {targets.map((t, index) => {
                const current = getCurrentEtp(t.centre_cout, t.depot);
                const gap = current - t.target_headcount;
                return (
                  <TableRow key={index}>
                    <TableCell>
                      <Select
                        value={t.centre_cout || "__all__"}
                        onValueChange={(v) => updateRow(index, "centre_cout", v === "__all__" ? "" : v)}
                      >
                        <SelectTrigger className="w-[160px] h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px] overflow-y-auto">
                          <SelectItem value="__all__">Tous</SelectItem>
                          {centres_cout.map((cc) => (
                            <SelectItem key={cc} value={cc}>{cc}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={t.depot || "__all__"}
                        onValueChange={(v) => updateRow(index, "depot", v === "__all__" ? "" : v)}
                      >
                        <SelectTrigger className="w-[200px] h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px] overflow-y-auto">
                          <SelectItem value="__all__">Tous les dépôts</SelectItem>
                          {depots.map((d) => (
                            <SelectItem key={d} value={d}>
                              {d.replace("Depots - ", "")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          value={t.work_time === "full_time" ? 100 : t.work_time === "part_time" ? 50 : parseInt(t.work_time) || 100}
                          onChange={(e) => {
                            const val = Math.max(0, Math.min(100, parseInt(e.target.value) || 0));
                            updateRow(index, "work_time", String(val));
                          }}
                          className="w-20 h-8 text-sm"
                          min="0"
                          max="100"
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        value={t.target_headcount}
                        onChange={(e) => updateRow(index, "target_headcount", parseInt(e.target.value) || 0)}
                        className="w-24 h-8 text-sm"
                        min="0"
                      />
                    </TableCell>
                    <TableCell className="text-sm font-medium">{current}</TableCell>
                    <TableCell>
                      {t.target_headcount > 0 ? (
                        <Badge
                          variant="outline"
                          className={`text-xs ${gap >= 0 ? "text-emerald-600 border-emerald-200" : "text-red-600 border-red-200"}`}
                        >
                          {gap >= 0 ? `+${gap}` : gap}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-red-600"
                        onClick={() => removeRow(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
