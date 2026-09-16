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
import { suspensionPartielle } from "@/lib/utils/wp-suspension";

export interface TempExitItem {
  code_salarie: string;
  nom_salarie?: string | null;
  vehicle_type: string;
  description_equipe: string;
  date_debut: string;
  date_fin: string | null;
  /** Congé pas encore commencé : début = date de sortie, fin non communiquée par le SIRH. */
  a_venir?: boolean;
  motif: string;
  /** ETP retiré par la suspension (fraction suspendue appliquée). */
  etp: number;
  /** ETP du salarié, pour afficher la fraction quand la suspension est partielle. */
  etp_salarie?: number;
}

// ---------------------------------------------------------------------------
// Sous-catégories
// ---------------------------------------------------------------------------

const SUBCATEGORIES: Record<string, { label: string; color: string; match: (motif: string) => boolean }> = {
  // « TP » = temps plein dans le SIRH (suspension complète, 1 ETP). Un vrai
  // temps partiel arriverait sous un autre code et tomberait dans « Congé parental (autre) ».
  parental_tp: { label: "Congé parental temps plein", color: "text-violet-600", match: (m) => m === "Conge Parental TP" },
  parental_partiel: { label: "Congé parental temps partiel", color: "text-violet-600", match: (m) => suspensionPartielle(m) !== null && m.toLowerCase().includes("parental") },
  parental: { label: "Congé parental (autre)", color: "text-violet-600", match: (m) => m.toLowerCase().includes("parental") && m !== "Conge Parental TP" },
  maternite: { label: "Congé maternité", color: "text-pink-600", match: (m) => m.toLowerCase().includes("maternité") || m.toLowerCase().includes("maternite") },
  sans_solde: { label: "Congé sans solde", color: "text-violet-600", match: (m) => m.toLowerCase().includes("sans solde") },
  accompagnement: { label: "Congé accompagnement", color: "text-blue-600", match: (m) => m.toLowerCase().includes("accompagnement") },
  dispense: { label: "Dispense", color: "text-gray-600", match: (m) => m.toLowerCase().includes("dispense") },
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
      return sub.match(d.motif);
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
          <TableCell className="text-sm">
            <span className="inline-flex items-center gap-2">
              {formatDate(d.date_debut)}
              {d.a_venir && (
                <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">À venir</span>
              )}
            </span>
          </TableCell>
          <TableCell className="text-sm">
            {d.a_venir && !d.date_fin
              ? <span className="text-muted-foreground">Non communiquée</span>
              : formatDate(d.date_fin)}
          </TableCell>
          <TableCell className="text-sm text-right">
            {d.etp}
            {d.etp_salarie != null && d.etp_salarie > d.etp && (
              <span className="ml-1 text-xs text-muted-foreground">
                {d.etp === 0 ? `(travaille à ${Math.round(d.etp_salarie * 100)} %)` : `/ ${d.etp_salarie}`}
              </span>
            )}
          </TableCell>
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
  const nbAVenir = items.filter((d) => d.a_venir).length;

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
          <>
            <div className="max-h-[500px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Salarié</TableHead>
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
            {nbAVenir > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                {nbAVenir} congé{nbAVenir > 1 ? "s" : ""} pas encore commencé{nbAVenir > 1 ? "s" : ""} : le SIRH n&apos;en communique
                que la date de début. La fin prévue n&apos;est connue qu&apos;une fois le congé ouvert.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
