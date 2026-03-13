"use client";

import { useState, useCallback, useEffect } from "react";
import { parseWpFile, detectFileType, type WpFileType, type WpParseResult } from "@/lib/utils/wp-excel-parser";
import { importWpData, getWpImportHistory } from "./actions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, FileSpreadsheet, Users, Activity, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { toast } from "sonner";

const FILE_TYPES: { id: WpFileType; label: string; description: string; icon: typeof Users; example: string }[] = [
  {
    id: "roster_rh",
    label: "Roster RH",
    description: "Effectifs avec dates d'entrée/sortie, contrats, équipes et dépôts.",
    icon: Users,
    example: "SLA_stat_mensuelle_*.xlsx",
  },
  {
    id: "salary_stats",
    label: "Statistiques salariales",
    description: "Données mensuelles : heures travaillées, ETP, coûts salariaux.",
    icon: FileSpreadsheet,
    example: "StatRapides_SLA_*.xlsx",
  },
  {
    id: "absences_cns",
    label: "Absences CNS",
    description: "Détail des absences : maladie, accident, maternité, congés parentaux.",
    icon: Activity,
    example: "SLA_Maladies_CNS_*.xlsx",
  },
  {
    id: "absences_mct",
    label: "Absences MCT",
    description: "Maladies court terme non prises en charge CNS.",
    icon: Activity,
    example: "ExportRechercheAbsences_*.xlsx",
  },
];

type Stage = "select" | "preview" | "importing" | "done";

interface ImportHistoryItem {
  id: string;
  file_name: string;
  file_type: string;
  mois: number | null;
  annee: number | null;
  imported_at: string;
  row_count: number;
  status: string;
  error_message: string | null;
}

export default function WorkforceImportPage() {
  const [stage, setStage] = useState<Stage>("select");
  const [selectedType, setSelectedType] = useState<WpFileType | null>(null);
  const [parseResult, setParseResult] = useState<WpParseResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null);
  const [progress, setProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [importHistory, setImportHistory] = useState<ImportHistoryItem[]>([]);
  const [overrideYear, setOverrideYear] = useState<number>(new Date().getFullYear());
  const [overrideMonth, setOverrideMonth] = useState<number>(0);

  useEffect(() => {
    getWpImportHistory().then((data) => setImportHistory(data as ImportHistoryItem[]));
  }, [stage]);

  const handleFile = useCallback(
    async (file: File, forceType?: WpFileType) => {
      if (!file.name.match(/\.xlsx?$/i) && !file.name.endsWith(".xlsb")) {
        toast.error("Veuillez sélectionner un fichier Excel (.xlsx)");
        return;
      }

      const buffer = await file.arrayBuffer();
      setFileBuffer(buffer);
      setFileName(file.name);

      // Auto-detect or use forced type
      let fileType = forceType || selectedType;
      if (!fileType) {
        fileType = detectFileType(buffer);
        if (!fileType) {
          toast.error("Type de fichier non reconnu automatiquement. Sélectionnez le type manuellement.");
          return;
        }
        setSelectedType(fileType);
      }

      const result = parseWpFile(buffer, fileType);
      setParseResult(result);

      if (result.detectedYear) setOverrideYear(result.detectedYear);
      if (result.detectedMonth) setOverrideMonth(result.detectedMonth);

      if (result.errors.length > 0) {
        toast.error(result.errors[0]);
      }

      setStage("preview");
    },
    [selectedType]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleImport = async () => {
    if (!parseResult || !selectedType || parseResult.data.length === 0) return;

    setStage("importing");
    setProgress(20);

    try {
      setProgress(50);
      const result = await importWpData({
        fileType: selectedType,
        fileName,
        data: parseResult.data,
        mois: overrideMonth || parseResult.detectedMonth,
        annee: overrideYear || parseResult.detectedYear,
      });

      setProgress(100);
      setStage("done");
      toast.success(`Import réussi — ${result.rowCount} lignes importées.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur lors de l'importation");
      setStage("preview");
    }
  };

  const resetImport = () => {
    setStage("select");
    setSelectedType(null);
    setParseResult(null);
    setFileName("");
    setFileBuffer(null);
    setProgress(0);
    setOverrideMonth(0);
  };

  const fileTypeMeta = selectedType ? FILE_TYPES.find((ft) => ft.id === selectedType) : null;
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 4 }, (_, i) => currentYear + 1 - i);
  const months = [
    { value: 1, label: "Janvier" }, { value: 2, label: "Février" }, { value: 3, label: "Mars" },
    { value: 4, label: "Avril" }, { value: 5, label: "Mai" }, { value: 6, label: "Juin" },
    { value: 7, label: "Juillet" }, { value: 8, label: "Août" }, { value: 9, label: "Septembre" },
    { value: 10, label: "Octobre" }, { value: 11, label: "Novembre" }, { value: 12, label: "Décembre" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Importation Workforce</h1>
        <p className="text-muted-foreground">
          Importez les fichiers RH pour alimenter le module Workforce Planning.
        </p>
      </div>

      {/* Stage: File type selection + upload */}
      {stage === "select" && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {FILE_TYPES.map((ft) => (
            <Card
              key={ft.id}
              className={`transition-colors ${selectedType === ft.id ? "border-primary" : "hover:border-primary/50"}`}
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ft.icon className="h-5 w-5" />
                  {ft.label}
                </CardTitle>
                <CardDescription>{ft.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); setSelectedType(ft.id); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => { setSelectedType(ft.id); handleDrop(e); }}
                  className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
                    isDragging && selectedType === ft.id ? "border-primary bg-primary/5" : "border-muted-foreground/25"
                  }`}
                >
                  <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
                  <p className="mb-2 text-sm text-muted-foreground">
                    Glissez ou cliquez
                  </p>
                  <Button variant="outline" size="sm" asChild>
                    <label className="cursor-pointer">
                      Sélectionner
                      <input
                        type="file"
                        accept=".xlsx,.xls,.xlsb"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            setSelectedType(ft.id);
                            handleFile(file, ft.id);
                          }
                        }}
                      />
                    </label>
                  </Button>
                  <p className="mt-2 text-xs text-muted-foreground/60">{ft.example}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Stage: Preview */}
      {stage === "preview" && parseResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Aperçu — {fileTypeMeta?.label}
            </CardTitle>
            <CardDescription>{fileName}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Errors */}
            {parseResult.errors.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                {parseResult.errors.map((e, i) => (
                  <p key={i} className="text-sm text-red-700">{e}</p>
                ))}
              </div>
            )}

            {/* Warnings */}
            {parseResult.warnings.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                {parseResult.warnings.map((w, i) => (
                  <p key={i} className="text-sm text-amber-700">{w}</p>
                ))}
              </div>
            )}

            {/* Summary */}
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Lignes détectées</p>
                <p className="text-2xl font-bold">{parseResult.rowCount}</p>
              </div>
              {parseResult.detectedMonth && (
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">Mois détecté</p>
                  <p className="text-2xl font-bold">{months.find((m) => m.value === parseResult.detectedMonth)?.label}</p>
                </div>
              )}
              {parseResult.detectedYear && (
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">Année détectée</p>
                  <p className="text-2xl font-bold">{parseResult.detectedYear}</p>
                </div>
              )}
            </div>

            {/* Month/Year override for salary_stats and absences */}
            {(selectedType === "salary_stats" || selectedType === "absences_cns" || selectedType === "absences_mct") && (
              <div className="flex items-end gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">Mois</Label>
                  <Select
                    value={String(overrideMonth || parseResult.detectedMonth || 1)}
                    onValueChange={(v) => setOverrideMonth(Number(v))}
                  >
                    <SelectTrigger className="w-[150px] h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {months.map((m) => (
                        <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Année</Label>
                  <Select
                    value={String(overrideYear)}
                    onValueChange={(v) => setOverrideYear(Number(v))}
                  >
                    <SelectTrigger className="w-[100px] h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {years.map((y) => (
                        <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Sample data preview */}
            {parseResult.data.length > 0 && (
              <div className="rounded-lg border overflow-auto max-h-64">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {Object.keys(parseResult.data[0]).slice(0, 8).map((key) => (
                        <TableHead key={key} className="text-xs whitespace-nowrap">{key}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parseResult.data.slice(0, 5).map((row, i) => (
                      <TableRow key={i}>
                        {Object.keys(row).slice(0, 8).map((key) => (
                          <TableCell key={key} className="text-xs whitespace-nowrap">
                            {String(row[key] ?? "")}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                    {parseResult.data.length > 5 && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-xs text-muted-foreground text-center">
                          ... et {parseResult.data.length - 5} autres lignes
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <Button onClick={handleImport} disabled={parseResult.data.length === 0 || parseResult.errors.length > 0}>
                Confirmer l&apos;importation ({parseResult.rowCount} lignes)
              </Button>
              <Button variant="outline" onClick={resetImport}>
                Annuler
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stage: Importing */}
      {stage === "importing" && (
        <Card>
          <CardContent className="flex flex-col items-center py-12">
            <p className="mb-4 text-lg font-medium">Importation en cours...</p>
            <Progress value={progress} className="mb-2 w-64" />
            <p className="text-sm text-muted-foreground">{progress}%</p>
          </CardContent>
        </Card>
      )}

      {/* Stage: Done */}
      {stage === "done" && (
        <Card>
          <CardContent className="flex flex-col items-center py-12">
            <CheckCircle2 className="mb-4 h-12 w-12 text-emerald-500" />
            <p className="mb-2 text-lg font-medium">Importation réussie</p>
            <p className="mb-6 text-sm text-muted-foreground">
              Les données ont été importées avec succès.
            </p>
            <div className="flex gap-3">
              <Button onClick={resetImport}>
                Importer un autre fichier
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Import History */}
      {importHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Historique des imports</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fichier</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Période</TableHead>
                  <TableHead>Lignes</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {importHistory.map((item) => {
                  const typeMeta = FILE_TYPES.find((ft) => ft.id === item.file_type);
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium text-sm">{item.file_name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{typeMeta?.label || item.file_type}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {item.mois && item.annee ? `${months.find((m) => m.value === item.mois)?.label || item.mois} ${item.annee}` : "-"}
                      </TableCell>
                      <TableCell className="text-sm">{item.row_count}</TableCell>
                      <TableCell>
                        {item.status === "completed" && (
                          <Badge variant="outline" className="text-emerald-600">
                            <CheckCircle2 className="mr-1 h-3 w-3" /> Terminé
                          </Badge>
                        )}
                        {item.status === "failed" && (
                          <Badge variant="outline" className="text-red-600">
                            <AlertCircle className="mr-1 h-3 w-3" /> Échoué
                          </Badge>
                        )}
                        {item.status === "processing" && (
                          <Badge variant="outline" className="text-amber-600">
                            <Clock className="mr-1 h-3 w-3" /> En cours
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(item.imported_at).toLocaleDateString("fr-FR", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
