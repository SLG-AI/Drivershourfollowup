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
import { PauseCircle, ChevronRight, ChevronDown } from "lucide-react";

export interface TempExitItem {
  code_salarie: string;
  vehicle_type: string;
  description_equipe: string;
  date_debut: string;
  date_fin: string | null;
  motif: string;
  etp: number;
}

// ---------------------------------------------------------------------------
// Sous-catégories
// ---------------------------------------------------------------------------

const SUBCATEGORIES: Record<string, { label: string; color: string; motifs: string[] }> = {
  parental: { label: "Congé parental", color: "text-violet-600", motifs: ["Conge Parental TP"] },
  maternite: { label: "Congé maternité", color: "text-pink-600", motifs: ["Congé de maternité"] },
  sans_solde: { label: "Congé sans solde", color: "text-violet-600", motifs: ["Congé sans solde"] },
  accompagnement: { label: "Congé accompagnement", color: "text-blue-600", motifs: ["Congé d'accompagnement"] },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupBySubcategory(items: TempExitItem[]) {
  const groups: { key: string; label: string; color: string; items: TempExitItem[]; etp: number }[] = [];
  const matched = new Set<number>();

  for (const [key, sub] of Object.entries(SUBCATEGORIES)) {
    const groupItems = items.filter((d, i) => {
      if (matched.has(i)) return false;
      return sub.motifs.includes(d.motif);
    });
    groupItems.forEach((d) => {
      const idx = items.indexOf(d);
      if (idx >= 0) matched.add(idx);
    });
    if (groupItems.length > 0) {
      const etp = Math.round(groupItems.reduce((sum, d) => sum + d.etp, 0) * 10) / 10;
      groups.push({ key, label: sub.label, color: sub.color, items: groupItems, etp });
    }
  }

  const remaining = items.filter((_, i) => !matched.has(i));
  if (remaining.length > 0) {
    const etp = Math.round(remaining.reduce((sum, d) => sum + d.etp, 0) * 10) / 10;
    groups.push({ key: "autre", label: "Autre", color: "text-gray-600", items: remaining, etp });
  }

  groups.sort((a, b) => b.items.length - a.items.length);
  return groups;
}

function formatDate(date: string | null) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EmployeeRows({ items }: { items: TempExitItem[] }) {
  return (
    <>
      {items.map((d, i) => (
        <TableRow key={`${d.code_salarie}-${i}`}>
          <TableCell className="text-sm font-medium pl-12">{d.code_salarie}</TableCell>
          <TableCell>
            <Badge variant="outline" className="text-xs">{d.vehicle_type}</Badge>
          </TableCell>
          <TableCell className="text-sm">{d.description_equipe}</TableCell>
          <TableCell className="text-sm">{formatDate(d.date_debut)}</TableCell>
          <TableCell className="text-sm">{formatDate(d.date_fin)}</TableCell>
          <TableCell className="text-sm text-right">{d.etp}</TableCell>
        </TableRow>
      ))}
    </>
  );
}

function SubcategorySection({
  group,
}: {
  group: { key: string; label: string; color: string; items: TempExitItem[]; etp: number };
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
              {group.etp} ETP
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

export function TempExitsTable({ items }: { items: TempExitItem[] }) {
  const totalEtp = Math.round(items.reduce((sum, d) => sum + d.etp, 0) * 10) / 10;
  const groups = groupBySubcategory(items);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PauseCircle className="h-4 w-4" />
          Sorties temporaires actuelles ({items.length} pers. — {totalEtp} ETP)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Aucune sortie temporaire en cours.
          </p>
        ) : (
          <div className="max-h-[500px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Code salarié</TableHead>
                  <TableHead className="text-xs">Type</TableHead>
                  <TableHead className="text-xs">Équipe</TableHead>
                  <TableHead className="text-xs">Début</TableHead>
                  <TableHead className="text-xs">Fin prévue</TableHead>
                  <TableHead className="text-xs text-right">ETP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => (
                  <SubcategorySection key={g.key} group={g} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
