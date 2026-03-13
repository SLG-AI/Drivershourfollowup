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
import { Activity, ChevronRight, ChevronDown } from "lucide-react";

export interface AbsenteeismItem {
  code_salarie: string;
  vehicle_type: string;
  description_equipe: string;
  pct_absenteisme: number;
  hrs_maladie: number;
  hrs_accident: number;
  hrs_maternite: number;
  hrs_raisons_familiales: number;
  hrs_conge_accompagnement: number;
  hrs_accueil: number;
  heures_theoriques: number;
  etp_perdu: number;
}

// ---------------------------------------------------------------------------
// Sous-catégories d'absence
// ---------------------------------------------------------------------------

interface AbsenceSubcategory {
  key: string;
  label: string;
  color: string;
  hrsField: keyof AbsenteeismItem;
}

const SUBCATEGORIES: AbsenceSubcategory[] = [
  { key: "maladie", label: "Maladie", color: "text-red-600", hrsField: "hrs_maladie" },
  { key: "accident", label: "Accident", color: "text-orange-600", hrsField: "hrs_accident" },
  { key: "maternite", label: "Maternité", color: "text-pink-600", hrsField: "hrs_maternite" },
  { key: "raisons_familiales", label: "Raisons familiales", color: "text-violet-600", hrsField: "hrs_raisons_familiales" },
  { key: "accompagnement", label: "Congé accompagnement", color: "text-blue-600", hrsField: "hrs_conge_accompagnement" },
  { key: "accueil", label: "Congé accueil", color: "text-teal-600", hrsField: "hrs_accueil" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupByCategory(items: AbsenteeismItem[]) {
  const groups: {
    key: string;
    label: string;
    color: string;
    items: AbsenteeismItem[];
    totalHrs: number;
    totalEtp: number;
  }[] = [];

  for (const sub of SUBCATEGORIES) {
    const matching = items.filter((d) => Number(d[sub.hrsField]) > 0);
    if (matching.length === 0) continue;

    const totalHrs = Math.round(matching.reduce((sum, d) => sum + Number(d[sub.hrsField]), 0) * 10) / 10;
    const totalEtp = Math.round(matching.reduce((sum, d) => sum + d.etp_perdu, 0) * 10) / 10;

    groups.push({
      key: sub.key,
      label: sub.label,
      color: sub.color,
      items: matching,
      totalHrs,
      totalEtp,
    });
  }

  groups.sort((a, b) => b.totalHrs - a.totalHrs);
  return groups;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EmployeeRows({ items, hrsField }: { items: AbsenteeismItem[]; hrsField: keyof AbsenteeismItem }) {
  const sorted = [...items].sort((a, b) => Number(b[hrsField]) - Number(a[hrsField]));

  return (
    <>
      {sorted.map((d, i) => (
        <TableRow key={`${d.code_salarie}-${i}`}>
          <TableCell className="text-sm font-medium pl-12">{d.code_salarie}</TableCell>
          <TableCell>
            <Badge variant="outline" className="text-xs">{d.vehicle_type}</Badge>
          </TableCell>
          <TableCell className="text-sm">{d.description_equipe}</TableCell>
          <TableCell className="text-sm text-right">{Math.round(Number(d[hrsField]) * 10) / 10}h</TableCell>
          <TableCell className="text-sm text-right">{d.pct_absenteisme.toFixed(1)}%</TableCell>
          <TableCell className="text-sm text-right">{d.etp_perdu.toFixed(2)}</TableCell>
        </TableRow>
      ))}
    </>
  );
}

function CategorySection({
  group,
  hrsField,
}: {
  group: { key: string; label: string; color: string; items: AbsenteeismItem[]; totalHrs: number; totalEtp: number };
  hrsField: keyof AbsenteeismItem;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50"
        onClick={() => setOpen(!open)}
      >
        <TableCell colSpan={6} className="pl-4">
          <div className="flex items-center gap-2">
            {open ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className={`text-sm font-medium ${group.color}`}>
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
      {open && <EmployeeRows items={group.items} hrsField={hrsField} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AbsenteeismTable({
  items,
  tauxGlobal,
  etpPerdusTotal,
}: {
  items: AbsenteeismItem[];
  tauxGlobal: number;
  etpPerdusTotal: number;
}) {
  const groups = groupByCategory(items);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4" />
          Détails couverture CNS ({items.length} pers. concernées — {tauxGlobal.toFixed(1)}% — {etpPerdusTotal.toFixed(1)} ETP perdus)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Aucune donnée d&apos;absentéisme pour ce mois.
          </p>
        ) : (
          <div className="max-h-[500px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Code salarié</TableHead>
                  <TableHead className="text-xs">Type</TableHead>
                  <TableHead className="text-xs">Équipe</TableHead>
                  <TableHead className="text-xs text-right">Heures abs.</TableHead>
                  <TableHead className="text-xs text-right">Taux abs.</TableHead>
                  <TableHead className="text-xs text-right">ETP perdu</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => {
                  const sub = SUBCATEGORIES.find((s) => s.key === g.key);
                  return (
                    <CategorySection
                      key={g.key}
                      group={g}
                      hrsField={sub?.hrsField ?? "hrs_maladie"}
                    />
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
