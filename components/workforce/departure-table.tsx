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
import { TrendingDown, ChevronRight, ChevronDown } from "lucide-react";

export interface DepartureItem {
  code_salarie: string;
  vehicle_type: string;
  description_equipe: string;
  date_sortie: string;
  motif: string;
  type: "definitive" | "temporaire";
}

// ---------------------------------------------------------------------------
// Sous-catégories par type
// ---------------------------------------------------------------------------

const SUBCATEGORIES_DEFINITIF: Record<string, { label: string; color: string; motifs: string[] }> = {
  pension: { label: "Pension", color: "text-amber-600", motifs: ["Pension de vieillesse"] },
  retraite: { label: "Retraite / Préretraite", color: "text-amber-600", motifs: ["Préretraite"] },
  fin_mission: { label: "Fin de mission", color: "text-blue-600", motifs: ["Fin de mission"] },
  licenciement: { label: "Licenciement", color: "text-red-600", motifs: ["Licenciement"] },
  demission: { label: "Démission", color: "text-red-600", motifs: ["Demission"] },
  resiliation: { label: "Rupture de commun accord", color: "text-orange-600", motifs: ["Résiliation commun accord"] },
  periode_essai: { label: "Rupture de plein droit", color: "text-orange-600", motifs: ["PeriodeEssaiNonConcluante"] },
  deces: { label: "Décès", color: "text-gray-600", motifs: ["Décès"] },
};

const SUBCATEGORIES_TEMPORAIRE: Record<string, { label: string; color: string; motifs: string[] }> = {
  parental: { label: "Congé parental", color: "text-violet-600", motifs: ["Conge Parental TP", "Congé parental"] },
  maternite: { label: "Congé maternité", color: "text-pink-600", motifs: ["Congé de maternité"] },
  sans_solde: { label: "Congé sans solde", color: "text-violet-600", motifs: ["Congé sans solde"] },
  accompagnement: { label: "Congé d'accompagnement", color: "text-violet-600", motifs: ["Congé d'accompagnement"] },
};

/** Motifs qui correspondent à des sorties temporaires (congés structurels) */
const MOTIFS_TEMPORAIRES = new Set(
  Object.values(SUBCATEGORIES_TEMPORAIRE).flatMap((s) => s.motifs)
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupBySubcategory(
  items: DepartureItem[],
  subcategories: Record<string, { label: string; color: string; motifs: string[] }>
) {
  const groups: { key: string; label: string; color: string; items: DepartureItem[] }[] = [];
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

  // Reste non catégorisé
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

function DepartureRows({ items }: { items: DepartureItem[] }) {
  return (
    <>
      {items.map((d, i) => (
        <TableRow key={`${d.code_salarie}-${i}`}>
          <TableCell className="text-sm font-medium pl-12">{d.code_salarie}</TableCell>
          <TableCell>
            <Badge variant="outline" className="text-xs">{d.vehicle_type}</Badge>
          </TableCell>
          <TableCell className="text-sm">{d.description_equipe}</TableCell>
          <TableCell className="text-sm">{formatDate(d.date_sortie)}</TableCell>
        </TableRow>
      ))}
    </>
  );
}

function SubcategorySection({
  group,
}: {
  group: { key: string; label: string; color: string; items: DepartureItem[] };
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
      {open && <DepartureRows items={group.items} />}
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
  items: DepartureItem[];
  subcategories: Record<string, { label: string; color: string; motifs: string[] }>;
}) {
  const [open, setOpen] = useState(false);
  const groups = groupBySubcategory(items, subcategories);

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
      {open &&
        groups.map((g) => <SubcategorySection key={g.key} group={g} />)}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DepartureTable({ departures }: { departures: DepartureItem[] }) {
  // Classer par motif : si le motif est un congé structurel → temporaire, sinon → définitif
  const definitifs = departures.filter((d) => !MOTIFS_TEMPORAIRES.has(d.motif));
  const temporaires = departures.filter((d) => MOTIFS_TEMPORAIRES.has(d.motif));

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
          <div className="max-h-[500px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Code salarié</TableHead>
                  <TableHead className="text-xs">Type</TableHead>
                  <TableHead className="text-xs">Équipe</TableHead>
                  <TableHead className="text-xs">Date sortie</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <CategorySection
                  label="Sorties définitives identifiées"
                  color="text-red-700"
                  icon="🔴"
                  items={definitifs}
                  subcategories={SUBCATEGORIES_DEFINITIF}
                />
                <CategorySection
                  label="Sorties temporaires identifiées"
                  color="text-amber-700"
                  icon="🟡"
                  items={temporaires}
                  subcategories={SUBCATEGORIES_TEMPORAIRE}
                />
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
