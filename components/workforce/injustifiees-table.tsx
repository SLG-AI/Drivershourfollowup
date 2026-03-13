"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, ChevronRight, ChevronDown } from "lucide-react";

export interface InjustifieeItem {
  code_salarie: string;
  nom_salarie: string;
  vehicle_type: string;
  description_equipe: string;
  nb_jours: number;
  total_hrs: number;
  etp_perdu: number;
}

function EmployeeRows({ items }: { items: InjustifieeItem[] }) {
  const sorted = [...items].sort((a, b) => b.total_hrs - a.total_hrs);

  return (
    <>
      {sorted.map((d, i) => (
        <TableRow key={`${d.code_salarie}-${i}`}>
          <TableCell className="text-sm font-medium pl-8">{d.code_salarie}</TableCell>
          <TableCell className="text-sm">{d.nom_salarie || "—"}</TableCell>
          <TableCell>
            <Badge variant="outline" className="text-xs">{d.vehicle_type}</Badge>
          </TableCell>
          <TableCell className="text-sm">{d.description_equipe}</TableCell>
          <TableCell className="text-sm text-right">{d.nb_jours}</TableCell>
          <TableCell className="text-sm text-right">{d.total_hrs}h</TableCell>
          <TableCell className="text-sm text-right">{d.etp_perdu.toFixed(2)}</TableCell>
        </TableRow>
      ))}
    </>
  );
}

export function InjustifieesTable({
  items,
  totalHrs,
  etpPerdusTotal,
}: {
  items: InjustifieeItem[];
  totalHrs: number;
  etpPerdusTotal: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle
          className="flex items-center gap-2 text-base cursor-pointer"
          onClick={() => setOpen(!open)}
        >
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <AlertTriangle className="h-4 w-4 text-yellow-600" />
          Détail absences injustifiées du mois ({items.length} pers. concernées — {totalHrs}h — {etpPerdusTotal.toFixed(1)} ETP perdus)
        </CardTitle>
      </CardHeader>
      {open && (
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Aucune absence injustifiée pour ce mois.
            </p>
          ) : (
            <div className="max-h-[500px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Code salarié</TableHead>
                    <TableHead className="text-xs">Nom</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs">Équipe</TableHead>
                    <TableHead className="text-xs text-right">Jours</TableHead>
                    <TableHead className="text-xs text-right">Heures</TableHead>
                    <TableHead className="text-xs text-right">ETP perdu</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <EmployeeRows items={items} />
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
