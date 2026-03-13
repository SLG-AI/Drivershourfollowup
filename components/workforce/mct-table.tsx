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
import { Thermometer, ChevronRight, ChevronDown } from "lucide-react";

export interface MctItem {
  code_salarie: string;
  nom_salarie: string;
  vehicle_type: string;
  description_equipe: string;
  prestation: string;
  total_hrs: number;
  nb_jours: number;
  etp_perdu: number;
}

// ---------------------------------------------------------------------------
// Groupement par prestation
// ---------------------------------------------------------------------------

function groupByPrestation(items: MctItem[]) {
  const map = new Map<string, MctItem[]>();
  for (const item of items) {
    const key = item.prestation || "Autre";
    const arr = map.get(key) || [];
    arr.push(item);
    map.set(key, arr);
  }

  return [...map.entries()]
    .map(([prestation, groupItems]) => {
      const totalHrs = Math.round(groupItems.reduce((sum, d) => sum + d.total_hrs, 0) * 10) / 10;
      const totalEtp = Math.round(groupItems.reduce((sum, d) => sum + d.etp_perdu, 0) * 10) / 10;
      return { key: prestation, label: prestation, items: groupItems, totalHrs, totalEtp };
    })
    .sort((a, b) => b.totalHrs - a.totalHrs);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatName(nom: string) {
  if (!nom) return "—";
  return nom;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EmployeeRows({ items }: { items: MctItem[] }) {
  const sorted = [...items].sort((a, b) => b.total_hrs - a.total_hrs);

  return (
    <>
      {sorted.map((d, i) => (
        <TableRow key={`${d.code_salarie}-${i}`}>
          <TableCell className="text-sm font-medium pl-12">{d.code_salarie}</TableCell>
          <TableCell className="text-sm">{formatName(d.nom_salarie)}</TableCell>
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

function PrestationSection({
  group,
}: {
  group: { key: string; label: string; items: MctItem[]; totalHrs: number; totalEtp: number };
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50"
        onClick={() => setOpen(!open)}
      >
        <TableCell colSpan={7} className="pl-4">
          <div className="flex items-center gap-2">
            {open ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="text-sm font-medium text-orange-600">
              {group.label}
            </span>
            <Badge variant="secondary" className="text-xs ml-1">
              {group.items.length} pers.
            </Badge>
            <span className="text-xs text-muted-foreground ml-auto">
              {group.totalHrs}h — {group.totalEtp} ETP perdus
            </span>
          </div>
        </TableCell>
      </TableRow>
      {open && <EmployeeRows items={group.items} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MctTable({
  items,
  totalHrs,
  etpPerdusTotal,
}: {
  items: MctItem[];
  totalHrs: number;
  etpPerdusTotal: number;
}) {
  const groups = groupByPrestation(items);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Thermometer className="h-4 w-4" />
          Détail MCT du mois ({items.length} pers. concernées — {totalHrs}h — {etpPerdusTotal.toFixed(1)} ETP perdus)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Aucune donnée MCT pour ce mois.
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
                {groups.map((g) => (
                  <PrestationSection key={g.key} group={g} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
