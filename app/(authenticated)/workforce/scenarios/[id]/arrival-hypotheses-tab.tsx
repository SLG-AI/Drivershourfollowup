"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ComboboxFreeText } from "@/components/ui/combobox-free-text";
import { Plus, Pencil, Trash2, Users, Copy } from "lucide-react";
import { toast } from "sonner";
import { addArrivalHypothesis, updateArrivalHypothesis, deleteArrivalHypothesis } from "../actions";
import type { ArrivalHypothesis } from "@/lib/utils/wp-calculations";

interface ComboboxOptions {
  fonctions: string[];
  centres_cout: string[];
  depots: string[];
}

interface Props {
  scenarioId: string;
  hypotheses: ArrivalHypothesis[];
  comboboxOptions: ComboboxOptions;
  selectedYear: number;
}

type FormData = {
  nb_personnes: number;
  taux_occupation: number;
  fonction: string | null;
  centre_cout: string | null;
  depot: string | null;
  type_contrat: "CDI" | "CDD";
  vehicle_type: "BUS" | "CAM" | null;
  start_day: number;
  start_month: number;
  start_year: number;
  end_day: number | null;
  end_month: number | null;
  end_year: number | null;
};

const defaultForm = (year: number): FormData => ({
  nb_personnes: 1,
  taux_occupation: 100,
  fonction: null,
  centre_cout: null,
  depot: null,
  type_contrat: "CDI",
  vehicle_type: null,
  start_day: 1,
  start_month: 1,
  start_year: year,
  end_day: null,
  end_month: null,
  end_year: null,
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

export function ArrivalHypothesesTab({ scenarioId, hypotheses: initialHypotheses, comboboxOptions, selectedYear }: Props) {
  const router = useRouter();
  const [hypotheses, setHypotheses] = useState(initialHypotheses);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(defaultForm(selectedYear));
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const openAdd = useCallback(() => {
    setEditingId(null);
    setForm(defaultForm(selectedYear));
    setDialogOpen(true);
  }, [selectedYear]);

  const openEdit = useCallback((h: ArrivalHypothesis) => {
    setEditingId(h.id);
    setForm({
      nb_personnes: h.nb_personnes,
      taux_occupation: h.taux_occupation,
      fonction: h.fonction,
      centre_cout: h.centre_cout,
      depot: h.depot,
      type_contrat: h.type_contrat,
      vehicle_type: h.vehicle_type,
      start_day: h.start_day,
      start_month: h.start_month,
      start_year: h.start_year,
      end_day: h.end_day,
      end_month: h.end_month,
      end_year: h.end_year,
    });
    setDialogOpen(true);
  }, []);

  const openDuplicate = useCallback((h: ArrivalHypothesis) => {
    setEditingId(null);
    setForm({
      nb_personnes: h.nb_personnes,
      taux_occupation: h.taux_occupation,
      fonction: h.fonction,
      centre_cout: h.centre_cout,
      depot: h.depot,
      type_contrat: h.type_contrat,
      vehicle_type: h.vehicle_type,
      start_day: h.start_day,
      start_month: h.start_month,
      start_year: h.start_year,
      end_day: h.end_day,
      end_month: h.end_month,
      end_year: h.end_year,
    });
    setDialogOpen(true);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editingId) {
        await updateArrivalHypothesis(editingId, form);
        setHypotheses((prev) => prev.map((h) => h.id === editingId ? { ...h, ...form } : h));
        toast.success("Hypothèse mise à jour");
      } else {
        const result = await addArrivalHypothesis(scenarioId, form);
        setHypotheses((prev) => [...prev, result as ArrivalHypothesis]);
        toast.success("Hypothèse ajoutée");
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
      await deleteArrivalHypothesis(id);
      setHypotheses((prev) => prev.filter((h) => h.id !== id));
      toast.success("Hypothèse supprimée");
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
              <Users className="h-4 w-4" />
              Hypothèses d&apos;arrivées
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
              Aucune hypothèse d&apos;arrivée. Cliquez sur &quot;Ajouter&quot; pour créer une hypothèse.
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
                      <TableHead className="text-xs">Fonction</TableHead>
                      <TableHead className="text-xs">Cost center</TableHead>
                      <TableHead className="text-xs">Dépôt</TableHead>
                      <TableHead className="text-xs">Véhicule</TableHead>
                      <TableHead className="text-xs">Contrat</TableHead>
                      <TableHead className="text-xs">Période</TableHead>
                      <TableHead className="text-xs">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {hypotheses.map((h) => {
                      const etp = (h.nb_personnes * h.taux_occupation / 100).toFixed(1);
                      const period = h.end_month && h.end_year
                        ? `${h.start_day}/${h.start_month}/${h.start_year} → ${h.end_day ?? 1}/${h.end_month}/${h.end_year}`
                        : `${h.start_day}/${h.start_month}/${h.start_year}`;
                      return (
                        <TableRow key={h.id}>
                          <TableCell className="text-sm font-medium">{h.nb_personnes}</TableCell>
                          <TableCell className="text-sm">{h.taux_occupation}%</TableCell>
                          <TableCell className="text-sm">{etp}</TableCell>
                          <TableCell className="text-sm">{h.fonction || "-"}</TableCell>
                          <TableCell className="text-sm">{h.centre_cout || "-"}</TableCell>
                          <TableCell className="text-sm">{h.depot || "-"}</TableCell>
                          <TableCell className="text-sm">{h.vehicle_type || "-"}</TableCell>
                          <TableCell>
                            <Badge variant={h.type_contrat === "CDI" ? "secondary" : "outline"} className="text-xs">
                              {h.type_contrat}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">{period}</TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openDuplicate(h)} title="Dupliquer">
                                <Copy className="h-3 w-3" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(h)} title="Modifier">
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive"
                                onClick={() => handleDelete(h.id)}
                                disabled={deletingId === h.id}
                                title="Supprimer"
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
            <DialogTitle>{editingId ? "Modifier l'hypothèse" : "Nouvelle hypothèse d'arrivée"}</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Nombre de personnes</Label>
              <Input
                type="number"
                min={1}
                value={form.nb_personnes}
                onChange={(e) => updateForm("nb_personnes", parseInt(e.target.value) || 1)}
              />
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

            <div className="space-y-2">
              <Label>Type de contrat</Label>
              <Select
                value={form.type_contrat}
                onValueChange={(v) => updateForm("type_contrat", v as "CDI" | "CDD")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CDI">CDI</SelectItem>
                  <SelectItem value="CDD">CDD</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2 border-t pt-4">
              <p className="text-sm font-medium mb-3">Période d&apos;arrivée</p>
              <div className="grid grid-cols-6 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Jour début</Label>
                  <Input
                    type="number"
                    className="h-8 text-xs"
                    min={1}
                    max={31}
                    value={form.start_day}
                    onChange={(e) => updateForm("start_day", Math.min(31, Math.max(1, parseInt(e.target.value) || 1)))}
                  />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Mois début</Label>
                  <Select
                    value={String(form.start_month)}
                    onValueChange={(v) => updateForm("start_month", parseInt(v))}
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
                  <Label className="text-xs">Année début</Label>
                  <Input
                    type="number"
                    className="h-8 text-xs"
                    value={form.start_year}
                    onChange={(e) => updateForm("start_year", parseInt(e.target.value) || selectedYear)}
                  />
                </div>
                <div className="col-span-2" />
                <div className="space-y-1">
                  <Label className="text-xs">Jour fin</Label>
                  <Input
                    type="number"
                    className="h-8 text-xs"
                    min={1}
                    max={31}
                    value={form.end_day ?? ""}
                    disabled={!form.end_month}
                    onChange={(e) => updateForm("end_day", Math.min(31, Math.max(1, parseInt(e.target.value) || 1)))}
                  />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Mois fin (optionnel)</Label>
                  <Select
                    value={form.end_month ? String(form.end_month) : "__none__"}
                    onValueChange={(v) => {
                      if (v === "__none__") {
                        updateForm("end_month", null);
                        updateForm("end_year", null);
                        updateForm("end_day", null);
                      } else {
                        updateForm("end_month", parseInt(v));
                        if (!form.end_year) updateForm("end_year", form.start_year);
                        if (!form.end_day) updateForm("end_day", 1);
                      }
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">—</SelectItem>
                      {MONTHS.map((m) => (
                        <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Année fin</Label>
                  <Input
                    type="number"
                    className="h-8 text-xs"
                    value={form.end_year ?? ""}
                    disabled={!form.end_month}
                    onChange={(e) => updateForm("end_year", parseInt(e.target.value) || null)}
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
