"use client";

import { useState, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ComboboxFreeText } from "@/components/ui/combobox-free-text";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, Pencil, Trash2, TrendingDown, ChevronsUpDown, X } from "lucide-react";
import { toast } from "sonner";
import { addDepartureHypothesis, updateDepartureHypothesis, deleteDepartureHypothesis } from "../actions";
import type { DepartureHypothesis, Employee } from "@/lib/utils/wp-calculations";

interface ComboboxOptions {
  fonctions: string[];
  centres_cout: string[];
  depots: string[];
}

interface Props {
  scenarioId: string;
  hypotheses: DepartureHypothesis[];
  comboboxOptions: ComboboxOptions;
  employees: Employee[];
  selectedYear: number;
}

type FormData = {
  code_salarie: string | null;
  nb_personnes: number;
  taux_occupation: number;
  fonction: string | null;
  centre_cout: string | null;
  depot: string | null;
  vehicle_type: "BUS" | "CAM" | null;
  departure_type: string;
  departure_day: number;
  departure_month: number;
  departure_year: number;
};

const DEPARTURE_TYPES = [
  { value: "retirement", label: "Retraite" },
  { value: "end_contract", label: "Fin de contrat" },
  { value: "turnover", label: "Turnover" },
  { value: "conge_parental", label: "Congé parental" },
  { value: "maternite", label: "Maternité" },
  { value: "autre", label: "Autre" },
];

const DEPARTURE_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  DEPARTURE_TYPES.map((t) => [t.value, t.label])
);

const defaultForm = (year: number): FormData => ({
  code_salarie: null,
  nb_personnes: 1,
  taux_occupation: 100,
  fonction: null,
  centre_cout: null,
  depot: null,
  vehicle_type: null,
  departure_type: "turnover",
  departure_day: 1,
  departure_month: 1,
  departure_year: year,
});

const MONTHS = [
  { value: 1, label: "Janvier" }, { value: 2, label: "Février" }, { value: 3, label: "Mars" },
  { value: 4, label: "Avril" }, { value: 5, label: "Mai" }, { value: 6, label: "Juin" },
  { value: 7, label: "Juillet" }, { value: 8, label: "Août" }, { value: 9, label: "Septembre" },
  { value: 10, label: "Octobre" }, { value: 11, label: "Novembre" }, { value: 12, label: "Décembre" },
];

function monthLabel(m: number) {
  return MONTHS.find((x) => x.value === m)?.label ?? String(m);
}

export function DepartureHypothesesTab({ scenarioId, hypotheses: initialHypotheses, comboboxOptions, employees, selectedYear }: Props) {
  const [hypotheses, setHypotheses] = useState(initialHypotheses);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(defaultForm(selectedYear));
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [employeeSearchOpen, setEmployeeSearchOpen] = useState(false);

  // Build employee lookup for pre-fill
  const employeeMap = useMemo(() => {
    const map = new Map<string, Employee>();
    employees.forEach((e) => map.set(e.code_salarie, e));
    return map;
  }, [employees]);

  const employeeCodes = useMemo(() =>
    employees.map((e) => e.code_salarie).sort(),
    [employees]
  );

  const openAdd = useCallback(() => {
    setEditingId(null);
    setForm(defaultForm(selectedYear));
    setDialogOpen(true);
  }, [selectedYear]);

  const openEdit = useCallback((h: DepartureHypothesis) => {
    setEditingId(h.id);
    setForm({
      code_salarie: h.code_salarie,
      nb_personnes: h.nb_personnes,
      taux_occupation: h.taux_occupation,
      fonction: h.fonction,
      centre_cout: h.centre_cout,
      depot: h.depot,
      vehicle_type: h.vehicle_type,
      departure_type: h.departure_type,
      departure_day: h.departure_day,
      departure_month: h.departure_month,
      departure_year: h.departure_year,
    });
    setDialogOpen(true);
  }, []);

  const handleSelectEmployee = useCallback((code: string | null) => {
    if (!code) {
      setForm((prev) => ({ ...prev, code_salarie: null, nb_personnes: 1 }));
      setEmployeeSearchOpen(false);
      return;
    }
    const emp = employeeMap.get(code);
    if (emp) {
      setForm((prev) => ({
        ...prev,
        code_salarie: code,
        nb_personnes: 1,
        taux_occupation: Number(emp.taux_occupation) || 100,
        fonction: emp.description_fonction ?? null,
        centre_cout: emp.centre_cout ?? null,
        depot: emp.description_departement || emp.description_service || null,
        vehicle_type: (emp.vehicle_type as "BUS" | "CAM") || null,
      }));
    } else {
      setForm((prev) => ({ ...prev, code_salarie: code, nb_personnes: 1 }));
    }
    setEmployeeSearchOpen(false);
  }, [employeeMap]);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editingId) {
        await updateDepartureHypothesis(editingId, form);
        setHypotheses((prev) => prev.map((h) => h.id === editingId ? { ...h, ...form } as DepartureHypothesis : h));
        toast.success("Hypothèse de départ mise à jour");
      } else {
        const result = await addDepartureHypothesis(scenarioId, form);
        setHypotheses((prev) => [...prev, { ...result, is_from_data: false } as DepartureHypothesis]);
        toast.success("Hypothèse de départ ajoutée");
      }
      setDialogOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteDepartureHypothesis(id);
      setHypotheses((prev) => prev.filter((h) => h.id !== id));
      toast.success("Hypothèse de départ supprimée");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur");
    } finally {
      setDeletingId(null);
    }
  };

  const updateForm = <K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  // Summary
  const totalPersonnes = hypotheses.reduce((s, h) => s + h.nb_personnes, 0);
  const totalEtp = hypotheses.reduce((s, h) => s + h.nb_personnes * h.taux_occupation / 100, 0);
  const busCount = hypotheses.filter((h) => h.vehicle_type === "BUS").reduce((s, h) => s + h.nb_personnes, 0);
  const camCount = hypotheses.filter((h) => h.vehicle_type === "CAM").reduce((s, h) => s + h.nb_personnes, 0);

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingDown className="h-4 w-4" />
              Hypothèses de départs
            </CardTitle>
            <Button size="sm" onClick={openAdd}>
              <Plus className="mr-2 h-4 w-4" />
              Ajouter
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {hypotheses.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Aucune hypothèse de départ. Cliquez sur &quot;Ajouter&quot; pour créer une hypothèse.
            </p>
          ) : (
            <>
              {/* Summary */}
              <div className="flex gap-4 mb-4 text-sm">
                <Badge variant="secondary">{totalPersonnes} personne(s)</Badge>
                <Badge variant="secondary">{totalEtp.toFixed(1)} ETP</Badge>
                {busCount > 0 && <Badge variant="outline">BUS: {busCount}</Badge>}
                {camCount > 0 && <Badge variant="outline">CAM: {camCount}</Badge>}
              </div>

              <div className="max-h-[500px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Nb</TableHead>
                      <TableHead className="text-xs">Taux occ.</TableHead>
                      <TableHead className="text-xs">ETP</TableHead>
                      <TableHead className="text-xs">Code salarié</TableHead>
                      <TableHead className="text-xs">Motif</TableHead>
                      <TableHead className="text-xs">Fonction</TableHead>
                      <TableHead className="text-xs">Cost center</TableHead>
                      <TableHead className="text-xs">Dépôt</TableHead>
                      <TableHead className="text-xs">Véhicule</TableHead>
                      <TableHead className="text-xs">Date départ</TableHead>
                      <TableHead className="text-xs">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {hypotheses.map((h) => {
                      const etp = (h.nb_personnes * h.taux_occupation / 100).toFixed(1);
                      return (
                        <TableRow key={h.id}>
                          <TableCell className="text-sm font-medium">{h.nb_personnes}</TableCell>
                          <TableCell className="text-sm">{h.taux_occupation}%</TableCell>
                          <TableCell className="text-sm">{etp}</TableCell>
                          <TableCell className="text-sm font-medium">{h.code_salarie || "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs whitespace-nowrap">
                              {DEPARTURE_TYPE_LABELS[h.departure_type] || h.departure_type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">{h.fonction || "—"}</TableCell>
                          <TableCell className="text-sm">{h.centre_cout || "—"}</TableCell>
                          <TableCell className="text-sm">{h.depot || "—"}</TableCell>
                          <TableCell className="text-sm">{h.vehicle_type || "—"}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">
                            {h.departure_day}/{h.departure_month}/{h.departure_year}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(h)}>
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive"
                                onClick={() => handleDelete(h.id)}
                                disabled={deletingId === h.id}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Modifier l'hypothèse de départ" : "Nouvelle hypothèse de départ"}</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4">
            {/* Employee search combobox */}
            <div className="space-y-2 col-span-2">
              <Label>Code salarié (optionnel — pré-remplit les champs)</Label>
              <div className="flex gap-2">
                <Popover open={employeeSearchOpen} onOpenChange={setEmployeeSearchOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={employeeSearchOpen}
                      className="flex-1 justify-between font-normal"
                    >
                      {form.code_salarie || "Sélectionner un employé..."}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[400px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Rechercher par code salarié..." />
                      <CommandList>
                        <CommandEmpty>Aucun employé trouvé.</CommandEmpty>
                        <CommandGroup>
                          {employeeCodes.map((code) => {
                            const emp = employeeMap.get(code);
                            return (
                              <CommandItem
                                key={code}
                                value={code}
                                onSelect={() => handleSelectEmployee(code)}
                              >
                                <span className="font-medium">{code}</span>
                                {emp && (
                                  <span className="ml-2 text-muted-foreground text-xs">
                                    {emp.vehicle_type || ""} — {emp.description_fonction || ""}
                                  </span>
                                )}
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                {form.code_salarie && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10"
                    onClick={() => handleSelectEmployee(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Nombre de personnes</Label>
              <Input
                type="number"
                min={1}
                value={form.nb_personnes}
                disabled={!!form.code_salarie}
                onChange={(e) => updateForm("nb_personnes", parseInt(e.target.value) || 1)}
              />
              {form.code_salarie && (
                <p className="text-xs text-muted-foreground">Fixé à 1 quand un employé est sélectionné</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Taux d&apos;occupation (%)</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={form.taux_occupation}
                onChange={(e) => updateForm("taux_occupation", parseFloat(e.target.value) || 100)}
              />
            </div>

            <div className="space-y-2 col-span-2">
              <Label>Motif de départ</Label>
              <Select
                value={form.departure_type}
                onValueChange={(v) => updateForm("departure_type", v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEPARTURE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Fonction</Label>
              <ComboboxFreeText
                options={comboboxOptions.fonctions}
                value={form.fonction}
                onChange={(v) => updateForm("fonction", v)}
                placeholder="Sélectionner une fonction..."
              />
            </div>
            <div className="space-y-2">
              <Label>Cost center</Label>
              <ComboboxFreeText
                options={comboboxOptions.centres_cout}
                value={form.centre_cout}
                onChange={(v) => updateForm("centre_cout", v)}
                placeholder="Sélectionner un cost center..."
              />
            </div>

            <div className="space-y-2">
              <Label>Dépôt</Label>
              <ComboboxFreeText
                options={comboboxOptions.depots}
                value={form.depot}
                onChange={(v) => updateForm("depot", v)}
                placeholder="Sélectionner un dépôt..."
              />
            </div>
            <div className="space-y-2">
              <Label>Type de véhicule</Label>
              <Select
                value={form.vehicle_type || "__none__"}
                onValueChange={(v) => updateForm("vehicle_type", v === "__none__" ? null : v as "BUS" | "CAM")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Non spécifié</SelectItem>
                  <SelectItem value="BUS">BUS</SelectItem>
                  <SelectItem value="CAM">CAM</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2 border-t pt-4">
              <p className="text-sm font-medium mb-3">Date de départ</p>
              <div className="grid grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Jour</Label>
                  <Input
                    type="number"
                    className="h-8 text-xs"
                    min={1}
                    max={31}
                    value={form.departure_day}
                    onChange={(e) => updateForm("departure_day", Math.min(31, Math.max(1, parseInt(e.target.value) || 1)))}
                  />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Mois</Label>
                  <Select
                    value={String(form.departure_month)}
                    onValueChange={(v) => updateForm("departure_month", parseInt(v))}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTHS.map((m) => (
                        <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Année</Label>
                  <Input
                    type="number"
                    className="h-8 text-xs"
                    value={form.departure_year}
                    onChange={(e) => updateForm("departure_year", parseInt(e.target.value) || selectedYear)}
                  />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Annuler</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Sauvegarde..." : editingId ? "Mettre à jour" : "Ajouter"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
