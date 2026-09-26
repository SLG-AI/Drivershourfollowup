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
import { Plus, Pencil, Trash2, Coins } from "lucide-react";
import { toast } from "sonner";
import { addCostParam, updateCostParam, deleteCostParam } from "../actions";
import { FRENCH_MONTHS, FRENCH_MONTHS_SHORT } from "@/lib/constants";
import {
  AIDE_LEVIER,
  LIBELLES_LEVIER,
  LIBELLES_MODE,
  MODE_PAR_TYPE,
  facteurHausse,
  unite,
  type LevierCout,
  type ModeLevier,
  type MoisAnnee,
  type TypeLevier,
} from "@/lib/utils/wp-leviers-cout";

interface Props {
  scenarioId: string;
  costParams: LevierCout[];
  costCenterOptions: string[];
  selectedYear: number;
  onCountChange?: (count: number) => void;
}

type FormData = {
  type: TypeLevier;
  centre_cout: string | null;
  annee_effet: number;
  mois_effet: number;
  valeur: number;
  mode: ModeLevier;
  libelle: string | null;
};

const TYPES: TypeLevier[] = ["indexation", "augmentation", "ssm", "coefficient", "prime"];

/** Premier mois projeté : le mois qui suit le mois courant (les mois écoulés sont lus dans les photos). */
function premierMoisProjete(): MoisAnnee {
  const now = new Date();
  const mois = now.getMonth() + 2;
  return mois > 12 ? { mois: 1, annee: now.getFullYear() + 1 } : { mois, annee: now.getFullYear() };
}

const defaultForm = (year: number): FormData => {
  const premier = premierMoisProjete();
  return {
    type: "indexation",
    centre_cout: null,
    annee_effet: premier.annee === year ? premier.annee : year,
    mois_effet: premier.annee === year ? premier.mois : 1,
    valeur: 2.5,
    mode: "pct",
    libelle: null,
  };
};

/** « Oct. 2026 » (le point ne suit que les abréviations) */
function effetLabel(mois: number, annee: number) {
  const court = FRENCH_MONTHS_SHORT[mois] ?? String(mois);
  const point = court === FRENCH_MONTHS[mois] ? "" : ".";
  return `${court}${point} ${annee}`;
}

function formatValeur(l: LevierCout) {
  const nombre = l.valeur.toLocaleString("fr-FR", { maximumFractionDigits: l.mode === "coef" ? 4 : 2 });
  return `${nombre} ${unite(l.mode)}`;
}

export function CostLeversTab({ scenarioId, costParams: initialCostParams, costCenterOptions, selectedYear, onCountChange }: Props) {
  const [leviers, setLeviers] = useState<LevierCout[]>(initialCostParams);
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

  const openEdit = useCallback((l: LevierCout) => {
    setEditingId(l.id ?? null);
    setForm({
      type: l.type,
      centre_cout: l.centre_cout,
      annee_effet: l.annee_effet,
      mois_effet: l.mois_effet,
      valeur: l.valeur,
      mode: l.mode,
      libelle: l.libelle ?? null,
    });
    setDialogOpen(true);
  }, []);

  const updateForm = <K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  // Changer de type impose le mode quand il n'y en a qu'un ; sinon on garde le mode s'il reste valide
  const changeType = (type: TypeLevier) => {
    setForm((prev) => {
      const modes = MODE_PAR_TYPE[type];
      return { ...prev, type, mode: modes.includes(prev.mode) ? prev.mode : modes[0] };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editingId) {
        await updateCostParam(editingId, form);
        setLeviers((prev) => prev.map((l) => (l.id === editingId ? { ...l, ...form } : l)));
        toast.success("Levier mis à jour");
      } else {
        const result = await addCostParam(scenarioId, form);
        const next = [...leviers, result as LevierCout];
        setLeviers(next);
        onCountChange?.(next.length);
        toast.success("Levier ajouté");
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
      await deleteCostParam(id);
      const next = leviers.filter((l) => l.id !== id);
      setLeviers(next);
      onCountChange?.(next.length);
      toast.success("Levier supprimé");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur");
    } finally {
      setDeletingId(null);
    }
  };

  // Aperçu : facteur cumulé des hausses globales, mois par mois sur l'année sélectionnée
  const apercu = useMemo(() => {
    const premier = premierMoisProjete();
    return Array.from({ length: 12 }, (_, i) => {
      const m: MoisAnnee = { mois: i + 1, annee: selectedYear };
      return { mois: m.mois, facteur: facteurHausse(leviers, null, m, premier) };
    });
  }, [leviers, selectedYear]);
  const premier = premierMoisProjete();

  const modesDuType = MODE_PAR_TYPE[form.type];
  const tries = useMemo(
    () => [...leviers].sort((a, b) => a.annee_effet * 12 + a.mois_effet - (b.annee_effet * 12 + b.mois_effet)),
    [leviers]
  );

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Coins className="h-4 w-4" />
              Leviers de coût
            </CardTitle>
            <Button size="sm" onClick={openAdd}>
              <Plus className="mr-2 h-4 w-4" />
              Ajouter
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {leviers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Aucun levier de coût. Cliquez sur &quot;Ajouter&quot; pour saisir une indexation, un SSM, un coefficient ou une prime.
            </p>
          ) : (
            <div className="max-h-[500px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs">Cost center</TableHead>
                    <TableHead className="text-xs">Effet</TableHead>
                    <TableHead className="text-xs">Valeur</TableHead>
                    <TableHead className="text-xs">Libellé</TableHead>
                    <TableHead className="text-xs">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tries.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-sm font-medium">
                        {LIBELLES_LEVIER[l.type]}
                        {l.type === "prime" && (
                          <span className="ml-1 text-xs text-muted-foreground">({LIBELLES_MODE[l.mode]})</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {l.centre_cout ? l.centre_cout : <Badge variant="secondary" className="text-xs">Global</Badge>}
                      </TableCell>
                      <TableCell className="text-sm">{effetLabel(l.mois_effet, l.annee_effet)}</TableCell>
                      <TableCell className="text-sm">{formatValeur(l)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{l.libelle || "-"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(l)} title="Modifier">
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            onClick={() => l.id && handleDelete(l.id)}
                            disabled={!l.id || deletingId === l.id}
                            title="Supprimer"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Aperçu du facteur cumulé global */}
          <div>
            <p className="text-sm font-medium mb-1">Facteur cumulé Global par mois — {selectedYear}</p>
            <p className="text-xs text-muted-foreground mb-3">
              Produit des indexations et augmentations globales effectives depuis le premier mois projeté
              ({effetLabel(premier.mois, premier.annee)}). Les mois antérieurs restent à ×1, leur brut vient des photos.
            </p>
            <div className="grid grid-cols-6 md:grid-cols-12 gap-1">
              {apercu.map((a) => {
                const actif = a.facteur !== 1;
                return (
                  <div
                    key={a.mois}
                    className={`rounded border px-1 py-1.5 text-center ${actif ? "border-primary/40 bg-primary/5" : "border-border"}`}
                  >
                    <div className="text-[10px] text-muted-foreground">{FRENCH_MONTHS_SHORT[a.mois]}</div>
                    <div className={`text-xs font-medium ${actif ? "" : "text-muted-foreground"}`}>
                      ×{a.facteur.toLocaleString("fr-FR", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Add/Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Modifier le levier" : "Nouveau levier de coût"}</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => changeType(v as TypeLevier)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{LIBELLES_LEVIER[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Mode</Label>
              {modesDuType.length > 1 ? (
                <Select value={form.mode} onValueChange={(v) => updateForm("mode", v as ModeLevier)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {modesDuType.map((mode) => (
                      <SelectItem key={mode} value={mode}>{LIBELLES_MODE[mode]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={LIBELLES_MODE[form.mode]} disabled />
              )}
            </div>

            <p className="col-span-2 text-xs text-muted-foreground">{AIDE_LEVIER[form.type]}</p>

            <div className="col-span-2 space-y-2">
              <Label>Cost center</Label>
              <ComboboxFreeText
                options={costCenterOptions}
                value={form.centre_cout}
                onChange={(v) => updateForm("centre_cout", v)}
                placeholder="Global (tous les cost centers)"
              />
            </div>

            <div className="space-y-2">
              <Label>Mois d&apos;effet</Label>
              <Select value={String(form.mois_effet)} onValueChange={(v) => updateForm("mois_effet", parseInt(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((mois) => (
                    <SelectItem key={mois} value={String(mois)}>{FRENCH_MONTHS[mois]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Année d&apos;effet</Label>
              <Input
                type="number"
                value={form.annee_effet}
                onChange={(e) => updateForm("annee_effet", parseInt(e.target.value) || selectedYear)}
              />
            </div>

            <div className="space-y-2">
              <Label>Valeur ({unite(form.mode)})</Label>
              <Input
                type="number"
                step={form.mode === "pct" ? 0.1 : form.mode === "coef" ? 0.01 : 1}
                value={form.valeur}
                onChange={(e) => updateForm("valeur", parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-2">
              <Label>Libellé (optionnel)</Label>
              <Input
                value={form.libelle ?? ""}
                onChange={(e) => updateForm("libelle", e.target.value || null)}
                placeholder="Ex. Tranche indiciaire, prime de fin d'année…"
              />
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
