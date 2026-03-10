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
import { TrendingUp, ChevronRight, ChevronDown } from "lucide-react";

export interface ArrivalItem {
  code_salarie: string;
  vehicle_type: string;
  description_equipe: string;
  date: string; // date_entree or date_fin_sortie_temporaire
  motif: string;
  type: "nouveau" | "retour";
}

// ---------------------------------------------------------------------------
// Sous-catégories par type
// ---------------------------------------------------------------------------

const SUBCATEGORIES_RETOUR: Record<string, { label: string; color: string; motifs: string[] }> = {
  parental: { label: "Retour congé parental", color: "text-violet-600", motifs: ["Conge Parental TP"] },
  maternite: { label: "Retour congé maternité", color: "text-pink-600", motifs: ["Congé de maternité"] },
  sans_solde: { label: "Retour congé sans solde", color: "text-violet-600", motifs: ["Congé sans solde"] },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupBySubcategory(
  items: ArrivalItem[],
  subcategories: Record<string, { label: string; color: string; motifs: string[] }>
) {
  const groups: { key: string; label: string; color: string; items: ArrivalItem[] }[] = [];
  const matched = new Set<number>();

  for (const [key, sub] of Object.entries(subcategories)) {
    const groupItems = items.filter((d, i) => {
      if (matched.has(i)) return false;
      return sub.motifs.includes(d.motif);
    });
    groupItems.forEach((d) => {
      const idx = items.indexOf(d);
      if (idx >= 0) matched.add(idx);
    });
    if (groupItems.length > 0) {
      groups.push({ key, label: sub.label, color: sub.color, items: groupItems });
    }
  }

  const remaining = items.filter((_, i) => !matched.has(i));
  if (remaining.length > 0) {
    groups.push({ key: "autre", label: "Autre", color: "text-gray-600", items: remaining });
  }

  groups.sort((a, b) => b.items.length - a.items.length);
  return groups;
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ArrivalRows({ items }: { items: ArrivalItem[] }) {
  return (
    <>
      {items.map((d, i) => (
        <TableRow key={`${d.code_salarie}-${i}`}>
          <TableCell className="text-sm font-medium pl-12">{d.code_salarie}</TableCell>
          <TableCell>
            <Badge variant="outline" className="text-xs">{d.vehicle_type}</Badge>
          </TableCell>
          <TableCell className="text-sm">{d.description_equipe}</TableCell>
          <TableCell className="text-sm">{formatDate(d.date)}</TableCell>
        </TableRow>
      ))}
    </>
  );
}

function SubcategorySection({
  group,
}: {
  group: { key: string; label: string; color: string; items: ArrivalItem[] };
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50"
        onClick={() => setOpen(!open)}
      >
        <TableCell colSpan={4} className="pl-8">
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
              {group.items.length}
            </Badge>
          </div>
        </TableCell>
      </TableRow>
      {open && <ArrivalRows items={group.items} />}
    </>
  );
}

function CategorySection({
  label,
  color,
  icon,
  items,
  subcategories,
}: {
  label: string;
  color: string;
  icon: string;
  items: ArrivalItem[];
  subcategories: Record<string, { label: string; color: string; motifs: string[] }> | null;
}) {
  const [open, setOpen] = useState(false);
  const groups = subcategories ? groupBySubcategory(items, subcategories) : null;

  if (items.length === 0) return null;

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50 bg-muted/30"
        onClick={() => setOpen(!open)}
      >
        <TableCell colSpan={4}>
          <div className="flex items-center gap-2">
            {open ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <span className="text-sm">{icon}</span>
            <span className={`text-sm font-semibold ${color}`}>{label}</span>
            <Badge variant="secondary" className="text-xs ml-1">
              {items.length}
            </Badge>
          </div>
        </TableCell>
      </TableRow>
      {open && groups
        ? groups.map((g) => <SubcategorySection key={g.key} group={g} />)
        : open && <ArrivalRows items={items} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ArrivalTable({ arrivals }: { arrivals: ArrivalItem[] }) {
  const nouveaux = arrivals.filter((a) => a.type === "nouveau");
  const retours = arrivals.filter((a) => a.type === "retour");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4" />
          Arrivées identifiées ({arrivals.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {arrivals.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Aucune arrivée identifiée.
          </p>
        ) : (
          <div className="max-h-[500px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Code salarié</TableHead>
                  <TableHead className="text-xs">Type</TableHead>
                  <TableHead className="text-xs">Équipe</TableHead>
                  <TableHead className="text-xs">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <CategorySection
                  label="Nouveaux engagés"
                  color="text-emerald-700"
                  icon="🟢"
                  items={nouveaux}
                  subcategories={null}
                />
                <CategorySection
                  label="Retours de suspension"
                  color="text-blue-700"
                  icon="🔵"
                  items={retours}
                  subcategories={SUBCATEGORIES_RETOUR}
                />
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
