"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendingDown } from "lucide-react";
import { FRENCH_MONTHS } from "@/lib/constants";

export interface DepartureItem {
  code_salarie: string;
  vehicle_type: string;
  description_equipe: string;
  date_sortie: string;
  motif: string;
  type: "definitive" | "temporaire";
}

const MOTIF_LABELS: Record<string, { label: string; color: string }> = {
  "Préretraite": { label: "Préretraite", color: "text-amber-600" },
  "Pension de vieillesse": { label: "Pension", color: "text-amber-600" },
  "Décès": { label: "Décès", color: "text-gray-600" },
  "Fin de mission": { label: "Fin mission", color: "text-blue-600" },
  "Conge Parental TP": { label: "Congé parental", color: "text-violet-600" },
  "Congé sans solde": { label: "Congé sans solde", color: "text-violet-600" },
  "Congé de maternité": { label: "Maternité", color: "text-pink-600" },
  "Licenciement": { label: "Licenciement", color: "text-red-600" },
  "Demission": { label: "Démission", color: "text-red-600" },
  "PeriodeEssaiNonConcluante": { label: "Fin période essai", color: "text-orange-600" },
  "Résiliation commun accord": { label: "Résiliation", color: "text-orange-600" },
};

export function DepartureTable({ departures }: { departures: DepartureItem[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingDown className="h-4 w-4" />
          Départs identifiés ({departures.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {departures.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Aucun départ identifié.
          </p>
        ) : (
          <div className="max-h-80 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Code salarié</TableHead>
                  <TableHead className="text-xs">Type</TableHead>
                  <TableHead className="text-xs">Équipe</TableHead>
                  <TableHead className="text-xs">Date sortie</TableHead>
                  <TableHead className="text-xs">Motif</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {departures.map((d, i) => {
                  const motifInfo = MOTIF_LABELS[d.motif] || { label: d.motif, color: "text-gray-600" };
                  return (
                    <TableRow key={`${d.code_salarie}-${i}`}>
                      <TableCell className="text-sm font-medium">{d.code_salarie}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{d.vehicle_type}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{d.description_equipe}</TableCell>
                      <TableCell className="text-sm">
                        {new Date(d.date_sortie).toLocaleDateString("fr-FR", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </TableCell>
                      <TableCell>
                        <span className={`text-xs font-medium ${motifInfo.color}`}>
                          {motifInfo.label}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
