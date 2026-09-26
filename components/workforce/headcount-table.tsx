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
import { Users, ChevronRight, ChevronDown } from "lucide-react";

export interface HeadcountItem {
  code_salarie: string;
  nom_salarie?: string | null;
  vehicle_type: string;
  description_equipe: string;
  centre_cout: string;
  type_contrat: string;
  date_entree: string | null;
  etp: number;
}

// ---------------------------------------------------------------------------
// Sous-catégories
//
// Les libellés bruts mêlent la nature du contrat et le poste occupé
// (« CDI CHAUFF. BUS », « CDD CHAUF. BUS », « CDI EMP. BUREAU SLA »…). On
// regroupe donc par NATURE, le libellé exact restant lisible sur chaque ligne.
// ---------------------------------------------------------------------------

const SUBCATEGORIES: Record<string, { label: string; color: string; match: (contrat: string) => boolean }> = {
  cdi: { label: "CDI", color: "text-emerald-600", match: (c) => c.toUpperCase().startsWith("CDI") },
  cdd: { label: "CDD", color: "text-amber-600", match: (c) => c.toUpperCase().startsWith("CDD") },
  interim: { label: "Intérim", color: "text-blue-600", match: (c) => c.toLowerCase().includes("interim") || c.toLowerCase().includes("intérim") },
  apprentissage: { label: "Apprentissage / Stage", color: "text-violet-600", match: (c) => c.toLowerCase().includes("apprenti") || c.toLowerCase().includes("stage") },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupBySubcategory(items: HeadcountItem[]) {
  const groups: { key: string; label: string; color: string; items: HeadcountItem[]; etp: number }[] = [];
  const matched = new Set<number>();

  for (const [key, sub] of Object.entries(SUBCATEGORIES)) {
    const groupItems: HeadcountItem[] = [];
    items.forEach((d, i) => {
      if (matched.has(i)) return;
      if (sub.match(d.type_contrat || "")) {
        groupItems.push(d);
        matched.add(i);
      }
    });
    if (groupItems.length > 0) {
      const etp = Math.round(groupItems.reduce((sum, d) => sum + d.etp, 0) * 10) / 10;
      groups.push({ key, label: sub.label, color: sub.color, items: groupItems, etp });
    }
  }

  const remaining = items.filter((_, i) => !matched.has(i));
  if (remaining.length > 0) {
    const etp = Math.round(remaining.reduce((sum, d) => sum + d.etp, 0) * 10) / 10;
    groups.push({ key: "autre", label: "Autre / non renseigné", color: "text-gray-600", items: remaining, etp });
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

function EmployeeRows({ items }: { items: HeadcountItem[] }) {
  return (
    <>
      {items.map((d, i) => (
        <TableRow key={`${d.code_salarie}-${i}`}>
          <TableCell className="text-sm font-medium pl-12">
            {d.nom_salarie ? (
              <div className="flex flex-col leading-tight">
                <span>{d.nom_salarie}</span>
                <span className="text-xs font-normal text-muted-foreground">{d.code_salarie}</span>
              </div>
            ) : (
              d.code_salarie
            )}
          </TableCell>
          <TableCell>
            <Badge variant="outline" className="text-xs">{d.vehicle_type}</Badge>
          </TableCell>
          <TableCell className="text-sm">{d.description_equipe}</TableCell>
          <TableCell className="text-sm">{d.centre_cout || "—"}</TableCell>
          <TableCell className="text-sm text-muted-foreground">{d.type_contrat || "—"}</TableCell>
          <TableCell className="text-sm">{formatDate(d.date_entree)}</TableCell>
          <TableCell className="text-sm text-right">{d.etp}</TableCell>
        </TableRow>
      ))}
    </>
  );
}

function SubcategorySection({
  group,
}: {
  group: { key: string; label: string; color: string; items: HeadcountItem[]; etp: number };
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

export function HeadcountTable({ items }: { items: HeadcountItem[] }) {
  const totalEtp = Math.round(items.reduce((sum, d) => sum + d.etp, 0) * 10) / 10;
  const groups = groupBySubcategory(items);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4" />
          Détails effectif sous contrat ({items.length} pers. — {totalEtp} ETP)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Aucun effectif pour cette période.
          </p>
        ) : (
          <div className="max-h-[500px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Salarié</TableHead>
                  <TableHead className="text-xs">Type</TableHead>
                  <TableHead className="text-xs">Équipe</TableHead>
                  <TableHead className="text-xs">Cost center</TableHead>
                  <TableHead className="text-xs">Contrat</TableHead>
                  <TableHead className="text-xs">Entrée</TableHead>
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
