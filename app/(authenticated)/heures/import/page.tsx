"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { parseExcelFile, type ParseResult, type SheetParseResult } from "@/lib/utils/excel-parser";
import { importData } from "./actions";
import { createClient } from "@/lib/supabase/client";
import { PERIODS, getCurrentPeriod, getPeriodLabel } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Clock, Layers } from "lucide-react";
import { toast } from "sonner";

type ImportStage = "upload" | "preview" | "importing" | "done";

interface SheetConfig {
  sheetIndex: number;
  enabled: boolean;
  periodNumber: number;
  year: number;
}

interface ImportHistoryItem {
  id: string;
  file_name: string;
  imported_at: string;
  row_count: number;
  status: string;
  reference_periods: { label: string } | null;
}

export default function ImportPage() {
  const router = useRouter();
  const [stage, setStage] = useState<ImportStage>("upload");
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [sheetConfigs, setSheetConfigs] = useState<SheetConfig[]>([]);
  const [progress, setProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [importHistory, setImportHistory] = useState<ImportHistoryItem[]>([]);

  useEffect(() => {
    async function fetchHistory() {
      const supabase = createClient();
      const { data } = await supabase
        .from("imports")
        .select("id, file_name, imported_at, row_count, status, reference_periods(label)")
        .order("imported_at", { ascending: false })
        .limit(10);
      if (data) setImportHistory(data as unknown as ImportHistoryItem[]);
    }
    fetchHistory();
  }, [stage]);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xls") && !file.name.endsWith(".xlsb")) {
        toast.error("Veuillez sélectionner un fichier Excel (.xlsx, .xlsb)");
        return;
      }

      setFileName(file.name);
      const buffer = await file.arrayBuffer();
      const result = parseExcelFile(buffer);
      setParseResult(result);

      if (result.globalErrors.length > 0) {
        toast.error(result.globalErrors[0]);
        return;
      }

      // Initialize sheet configs from detected periods
      const defaultYear = getCurrentPeriod().year;
      const configs: SheetConfig[] = result.sheets.map((sheet, i) => ({
        sheetIndex: i,
        enabled: sheet.data.length > 0 && sheet.errors.length === 0,
        periodNumber: sheet.detectedPeriod?.periodNumber || getCurrentPeriod().periodNumber,
        year: sheet.detectedPeriod?.year || defaultYear,
      }));

      // Auto-disable duplicate periods: keep the sheet with the most data
      const seen = new Map<string, number>(); // "periodNumber-year" → config index
      for (let i = 0; i < configs.length; i++) {
        if (!configs[i].enabled) continue;
        const key = `${configs[i].periodNumber}-${configs[i].year}`;
        if (seen.has(key)) {
          const prevIndex = seen.get(key)!;
          const prevCount = result.sheets[configs[prevIndex].sheetIndex].data.length;
          const currCount = result.sheets[configs[i].sheetIndex].data.length;
          // Disable the one with fewer rows
          if (currCount > prevCount) {
            configs[prevIndex].enabled = false;
          } else {
            configs[i].enabled = false;
          }
        } else {
          seen.set(key, i);
        }
      }

      setSheetConfigs(configs);
      setStage("preview");
    },
    []
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

  const updateSheetConfig = (index: number, updates: Partial<SheetConfig>) => {
    setSheetConfigs((prev) =>
      prev.map((c, i) => (i === index ? { ...c, ...updates } : c))
    );
  };

  const handleImport = async () => {
    if (!parseResult) return;

    const enabledSheets = sheetConfigs
      .filter((c) => c.enabled)
      .map((c) => ({
        data: parseResult.sheets[c.sheetIndex].data,
        periodNumber: c.periodNumber,
        year: c.year,
      }));

    if (enabledSheets.length === 0) {
      toast.error("Sélectionnez au moins un onglet à importer.");
      return;
    }

    setStage("importing");
    setProgress(10);

    try {
      setProgress(30);
      const result = await importData({
        sheets: enabledSheets,
        fileName,
      });
      setProgress(100);
      setStage("done");

      const summary = result.results
        .map((r) => `${r.periodLabel}: ${r.driversCount} chauffeurs`)
        .join(", ");
      toast.success(`Import réussi — ${summary}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erreur lors de l'importation"
      );
      setStage("preview");
    }
  };

  const currentYears = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);
  const enabledCount = sheetConfigs.filter((c) => c.enabled).length;
  const totalDrivers = parseResult
    ? sheetConfigs
        .filter((c) => c.enabled)
        .reduce((sum, c) => sum + parseResult.sheets[c.sheetIndex].data.length, 0)
    : 0;
  const totalRecords = parseResult
    ? sheetConfigs
        .filter((c) => c.enabled)
        .reduce(
          (sum, c) =>
            sum + parseResult.sheets[c.sheetIndex].data.reduce((s, d) => s + d.months.length, 0),
          0
        )
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Importation des données</h1>
        <p className="text-muted-foreground">
          Importez le fichier Excel global des heures pour alimenter l&apos;application.
        </p>
      </div>

      {/* Upload */}
      {stage === "upload" && (
        <Card>
          <CardHeader>
            <CardTitle>Importer un fichier</CardTitle>
            <CardDescription>
              Glissez-déposez votre fichier Excel ou cliquez pour sélectionner. Les fichiers multi-onglets sont supportés.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors ${
                isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25"
              }`}
            >
              <Upload className="mb-4 h-10 w-10 text-muted-foreground" />
              <p className="mb-2 text-sm font-medium">
                Glissez votre fichier .xlsx ou .xlsb ici
              </p>
              <p className="mb-4 text-xs text-muted-foreground">ou</p>
              <Button variant="outline" asChild>
                <label className="cursor-pointer">
                  Sélectionner un fichier
                  <input
                    type="file"
                    accept=".xlsx,.xls,.xlsb"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFile(file);
                    }}
                  />
                </label>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Preview */}
      {stage === "preview" && parseResult && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5" />
                Aperçu de l&apos;import
              </CardTitle>
              <CardDescription>{fileName}</CardDescription>
            </CardHeader>
            <CardContent>
              {/* Global summary */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">Onglets sélectionnés</p>
                  <p className="text-2xl font-bold">{enabledCount} / {parseResult.sheets.length}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">Chauffeurs total</p>
                  <p className="text-2xl font-bold">{totalDrivers}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">Enregistrements total</p>
                  <p className="text-2xl font-bold">{totalRecords}</p>
                </div>
              </div>

              <div className="flex gap-3">
                <Button onClick={handleImport} disabled={enabledCount === 0}>
                  Confirmer l&apos;importation ({enabledCount} période{enabledCount > 1 ? "s" : ""})
                </Button>
                <Button variant="outline" onClick={() => { setStage("upload"); setParseResult(null); }}>
                  Annuler
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Per-sheet details */}
          {parseResult.sheets.map((sheet, index) => {
            const config = sheetConfigs[index];
            if (!config) return null;
            const hasErrors = sheet.errors.length > 0;
            const hasData = sheet.data.length > 0;
            // Check if another enabled sheet has the same period
            const isDuplicate = hasData && !hasErrors && sheetConfigs.some(
              (other, j) => j !== index && other.enabled &&
                other.periodNumber === config.periodNumber && other.year === config.year
            );

            return (
              <Card key={index} className={!config.enabled ? "opacity-60" : ""}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Layers className="h-4 w-4" />
                      Onglet : {sheet.sheetName}
                      {hasErrors && (
                        <Badge variant="destructive" className="text-xs">Erreur</Badge>
                      )}
                      {!hasErrors && hasData && (
                        <Badge variant="outline" className="text-xs text-emerald-600">
                          {sheet.data.length} chauffeurs — {sheet.detectedMonths.length} mois
                        </Badge>
                      )}
                      {isDuplicate && !config.enabled && (
                        <Badge variant="outline" className="text-xs text-amber-600">
                          Doublon
                        </Badge>
                      )}
                    </CardTitle>
                    {hasData && !hasErrors && (
                      <Button
                        variant={config.enabled ? "default" : "outline"}
                        size="sm"
                        onClick={() => updateSheetConfig(index, { enabled: !config.enabled })}
                      >
                        {config.enabled ? "Inclus" : "Exclu"}
                      </Button>
                    )}
                  </div>
                </CardHeader>
                {config.enabled && hasData && (
                  <CardContent className="space-y-4">
                    {/* Warnings */}
                    {sheet.warnings.length > 0 && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                        {sheet.warnings.map((w, i) => (
                          <p key={i} className="text-sm text-amber-700">{w}</p>
                        ))}
                      </div>
                    )}

                    {/* Period/Year selectors */}
                    <div className="flex items-center gap-4">
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">Année</p>
                        <Select
                          value={String(config.year)}
                          onValueChange={(v) => updateSheetConfig(index, { year: Number(v) })}
                        >
                          <SelectTrigger className="w-[100px] h-8 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {currentYears.map((y) => (
                              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">Période</p>
                        <Select
                          value={String(config.periodNumber)}
                          onValueChange={(v) => updateSheetConfig(index, { periodNumber: Number(v) })}
                        >
                          <SelectTrigger className="w-[160px] h-8 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PERIODS.map((p) => (
                              <SelectItem key={p.number} value={String(p.number)}>
                                {p.label} (mois {p.startMonth}-{p.endMonth})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="pt-4">
                        <Badge variant="secondary" className="text-xs">
                          {getPeriodLabel(config.periodNumber, config.year)}
                        </Badge>
                      </div>
                    </div>

                    {/* Sample rows */}
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Code salarié</TableHead>
                          <TableHead className="text-xs">Type</TableHead>
                          <TableHead className="text-xs">Buffer</TableHead>
                          <TableHead className="text-xs">Mois</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sheet.data.slice(0, 3).map((d, i) => (
                          <TableRow key={i}>
                            <TableCell className="text-sm font-medium">{d.codeSalarie}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">{d.vehicleType}</Badge>
                            </TableCell>
                            <TableCell className="text-sm">{d.bufferHours}h</TableCell>
                            <TableCell className="text-sm">{d.months.length}</TableCell>
                          </TableRow>
                        ))}
                        {sheet.data.length > 3 && (
                          <TableRow>
                            <TableCell colSpan={4} className="text-xs text-muted-foreground text-center">
                              ... et {sheet.data.length - 3} autres chauffeurs
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                )}
                {hasErrors && (
                  <CardContent>
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                      {sheet.errors.map((e, i) => (
                        <p key={i} className="text-sm text-red-700">{e}</p>
                      ))}
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </>
      )}

      {/* Importing */}
      {stage === "importing" && (
        <Card>
          <CardContent className="flex flex-col items-center py-12">
            <p className="mb-4 text-lg font-medium">Importation en cours...</p>
            <Progress value={progress} className="mb-2 w-64" />
            <p className="text-sm text-muted-foreground">{progress}%</p>
          </CardContent>
        </Card>
      )}

      {/* Done */}
      {stage === "done" && (
        <Card>
          <CardContent className="flex flex-col items-center py-12">
            <CheckCircle2 className="mb-4 h-12 w-12 text-emerald-500" />
            <p className="mb-2 text-lg font-medium">Importation réussie</p>
            <p className="mb-6 text-sm text-muted-foreground">
              Les données ont été importées avec succès.
            </p>
            <div className="flex gap-3">
              <Button onClick={() => router.push("/heures/dashboard")}>
                Voir le tableau de bord
              </Button>
              <Button variant="outline" onClick={() => { setStage("upload"); setParseResult(null); }}>
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
                  <TableHead>Période</TableHead>
                  <TableHead>Chauffeurs</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {importHistory.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.file_name}</TableCell>
                    <TableCell>{item.reference_periods?.label || "-"}</TableCell>
                    <TableCell>{item.row_count}</TableCell>
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
                    <TableCell className="text-muted-foreground">
                      {new Date(item.imported_at).toLocaleDateString("fr-FR", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
