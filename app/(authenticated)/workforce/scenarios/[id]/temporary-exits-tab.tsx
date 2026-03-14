"use client";

import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ComboboxFreeText } from "@/components/ui/combobox-free-text";
import { Plus, Pencil, Trash2, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { addTempExitHypothesis, updateTempExitHypothesis, deleteTempExitHypothesis } from "../actions";
import type { TempExitHypothesis } from "@/lib/utils/wp-calculations";

interface ComboboxOptions {
  fonctions: string[];
  centres_cout: string[];
  depots: string[];
}

interface Props {
  scenarioId: string;
  hypotheses: TempExitHypothesis[];
  comboboxOptions: ComboboxOptions;
  selectedYear: number;
}

type FormData = {
  nb_personnes: number;
  taux_occupation: number;
  fonction: string | null;
  centre_cout: string | null;
  depot: string | null;
  vehicle_type: "BUS" | "CAM" | null;
  motif: string;
  departure_day: number;
  departure_month: number;
  departure_year: number;
  return_day: number | null;
  return_month: number | null;
  return_year: number | null;
};

const MOTIFS = [
  "Congé parental",
  "Congé maternité",
  "Congé sans solde",
  "Congé d'accompagnement",
];

const defaultForm = (year: number): FormData => ({
  nb_personnes: 1,
  taux_occupation: 100,
  fonction: null,
  centre_cout: null,
  depot: null,
  vehicle_type: null,
  motif: "Congé parental",
  departure_day: 1,
  departure_month: 1,
  departure_year: year,
  return_day: null,
  return_month: null,
  return_year: null,
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

export function TemporaryExitsTab({ scenarioId, hypotheses: initialHypotheses, comboboxOptions, selectedYear }: Props) {
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

  const openEdit = useCallback((h: TempExitHypothesis) => {
    setEditingId(h.id);
    setForm({
      nb_personnes: h.nb_personnes,
      taux_occupation: h.taux_occupation,
      fonction: h.fonction,
      centre_cout: h.centre_cout,
      depot: h.depot,
      vehicle_type: h.vehicle_type,
      motif: h.motif,
      departure_day: h.departure_day,
      departure_month: h.departure_month,
      departure_year: h.departure_year,
      return_day: h.return_day,
      return_month: h.return_month,
      return_year: h.return_year,
    });
    setDialogOpen(true);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editingId) {
        await updateTempExitHypothesis(editingId, form);
        setHypotheses((prev) => prev.map((h) => h.id === editingId ? { ...h, ...form } : h));
        toast.success("Sortie temporaire mise à jour");
      } else {
        const result = await addTempExitHypothesis(scenarioId, form);
        setHypotheses((prev) => [...prev, result as TempExitHypothesis]);
        toast.success("Sortie temporaire ajoutée");
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
      await deleteTempExitHypothesis(id);
      setHypotheses((prev) => prev.filter((h) => h.id !== id));
      toast.success("Sortie temporaire supprimée");
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
              <UserMinus className="h-4 w-4" />
              Sorties temporaires
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
              Aucune sortie temporaire. Cliquez sur &quot;Ajouter&quot; pour créer une hypothèse.
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
                      <TableHead className="text-xs">Motif</TableHead>
                      <TableHead className="text-xs">Fonction</TableHead>
                      <TableHead className="text-xs">Cost center</TableHead>
                      <TableHead className="text-xs">Dépôt</TableHead>
                      <TableHead className="text-xs">Véhicule</TableHead>
                      <TableHead className="text-xs">Départ</TableHead>
                      <TableHead className="text-xs">Retour</TableHead>
                      <TableHead className="text-xs">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {hypotheses.map((h) => {
                      const etp = (h.nb_personnes * h.taux_occupation / 100).toFixed(1);
                      const departure = `${h.departure_day}/${h.departure_month}/${h.departure_year}`;
                      const returnDate = h.return_month && h.return_year
                        ? `${h.return_day ?? 1}/${h.return_month}/${h.return_year}`
                        : "—";
                      return (
                        <TableRow key={h.id}>
                          <TableCell className="text-sm font-medium">{h.nb_personnes}</TableCell>
                          <TableCell className="text-sm">{h.taux_occupation}%</TableCell>
                          <TableCell className="text-sm">{etp}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs whitespace-nowrap">
                              {h.motif}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">{h.fonction || "—"}</TableCell>
                          <TableCell className="text-sm">{h.centre_cout || "—"}</TableCell>
                          <TableCell className="text-sm">{h.depot || "—"}</TableCell>
                          <TableCell className="text-sm">{h.vehicle_type || "—"}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{departure}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{returnDate}</TableCell>
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
            <DialogTitle>{editingId ? "Modifier la sortie temporaire" : "Nouvelle sortie temporaire"}</DialogTitle>
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

            <div className="space-y-2 col-span-2">
              <Label>Motif</Label>
              <Select
                value={form.motif}
                onValueChange={(v) => updateForm("motif", v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MOTIFS.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
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

            <div className="col-span-2 border-t pt-4">
              <p className="text-sm font-medium mb-3">Date de retour (optionnel)</p>
              <div className="grid grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Jour</Label>
                  <Input
                    type="number"
                    className="h-8 text-xs"
                    min={1}
                    max={31}
                    value={form.return_day ?? ""}
                    disabled={!form.return_month}
                    onChange={(e) => updateForm("return_day", Math.min(31, Math.max(1, parseInt(e.target.value) || 1)))}
                  />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Mois</Label>
                  <Select
                    value={form.return_month ? String(form.return_month) : "__none__"}
                    onValueChange={(v) => {
                      if (v === "__none__") {
                        updateForm("return_month", null);
                        updateForm("return_year", null);
                        updateForm("return_day", null);
                      } else {
                        updateForm("return_month", parseInt(v));
                        if (!form.return_year) updateForm("return_year", form.departure_year);
                        if (!form.return_day) updateForm("return_day", 1);
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
                  <Label className="text-xs">Année</Label>
                  <Input
                    type="number"
                    className="h-8 text-xs"
                    value={form.return_year ?? ""}
                    disabled={!form.return_month}
                    onChange={(e) => updateForm("return_year", parseInt(e.target.value) || null)}
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
