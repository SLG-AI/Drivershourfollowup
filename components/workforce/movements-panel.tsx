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
import { ArrowLeftRight, ChevronRight, ChevronDown } from "lucide-react";
import { soldeEtp, type MovementItem, type RosterMovements } from "@/lib/utils/wp-movements";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(date: string | null) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function signe(n: number) {
  return n > 0 ? `+${n}` : String(n);
}

function formatEtp(n: number) {
  const v = Math.round(n * 100) / 100;
  return `${v > 0 ? "+" : ""}${v.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} ETP`;
}

/** Somme des ETP d'une catégorie, signée selon son sens (arrivée +, sortie −). */
function etpCategorie(items: MovementItem[], sens: 1 | -1): number {
  return sens * items.reduce((s, i) => s + i.etp, 0);
}

function formatTaux(t: number) {
  return `${t.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MovementRows({ items, dateSuffix }: { items: MovementItem[]; dateSuffix?: string }) {
  return (
    <>
      {items.map((d, i) => (
        <TableRow key={`${d.code_salarie}-${i}`}>
          <TableCell className="text-sm font-medium pl-10">
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
          {d.deltaEtp !== undefined ? (
            <>
              <TableCell className="text-sm">
                {formatTaux(d.tauxAvant ?? 0)} → {formatTaux(d.tauxApres ?? 0)}
              </TableCell>
              <TableCell className={`text-sm font-medium ${d.deltaEtp < 0 ? "text-red-700" : "text-green-700"}`}>
                {formatEtp(d.deltaEtp)}
              </TableCell>
            </>
          ) : (
            <>
              <TableCell className="text-sm text-muted-foreground">
                {d.motif || "—"}
                {(d.etpSuspenduAvant ?? 0) > 0 && (
                  <span className="ml-1 text-xs text-amber-700">
                    (était en suspension{(d.etpSuspenduAvant ?? 0) < d.etp ? " partielle" : ""})
                  </span>
                )}
              </TableCell>
              <TableCell className="text-sm">
                {formatDate(d.date)}
                {dateSuffix && d.date && (
                  <span className="ml-1 text-xs text-muted-foreground">{dateSuffix}</span>
                )}
              </TableCell>
            </>
          )}
        </TableRow>
      ))}
    </>
  );
}

function CategorySection({
  label,
  color,
  icon,
  items,
  hint,
  dateSuffix,
  etp,
  masquerSiVide = false,
}: {
  label: string;
  color: string;
  icon: string;
  items: MovementItem[];
  hint?: string;
  dateSuffix?: string;
  /** Total ETP de la catégorie, signé ; affiché à droite comme dans le détail MCT. */
  etp?: number;
  /** Ligne d'anomalie : ne s'affiche que si des salariés sont concernés. */
  masquerSiVide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const vide = items.length === 0;
  if (vide && masquerSiVide) return null;

  return (
    <>
      <TableRow
        className={vide ? "bg-muted/30" : "cursor-pointer hover:bg-muted/50 bg-muted/30"}
        onClick={() => !vide && setOpen(!open)}
      >
        <TableCell colSpan={5}>
          <div className="flex items-center gap-2">
            {vide ? (
              <span className="h-4 w-4" />
            ) : open ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <span className="text-sm">{icon}</span>
            <span className={`text-sm font-semibold ${vide ? "text-muted-foreground" : color}`}>{label}</span>
            <Badge variant="secondary" className="text-xs ml-1">
              {items.length}
            </Badge>
            {hint && <span className="text-xs text-muted-foreground ml-2">{hint}</span>}
            {etp !== undefined && !vide && (
              <span className={`text-xs ml-auto ${etp < 0 ? "text-red-700" : etp > 0 ? "text-green-700" : "text-muted-foreground"}`}>
                {formatEtp(etp)}
              </span>
            )}
          </div>
        </TableCell>
      </TableRow>
      {open && <MovementRows items={items} dateSuffix={dateSuffix} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MovementsPanel({
  movements,
  moisPrecedentLabel,
  moisLabel,
}: {
  movements: RosterMovements;
  moisPrecedentLabel: string;
  moisLabel: string;
}) {
  const arrivees = movements.nouveaux.length + movements.retours.length;
  const sorties =
    movements.sortiesDefinitives.length +
    movements.sortiesTemporaires.length +
    movements.disparusSansDate.length;
  const solde = arrivees - sorties;
  const total = arrivees + sorties + movements.changementsTemps.length;
  const { sousContrat: etpSousContrat, net: etpNet } = soldeEtp(movements);
  const sortiesDejaSuspendues = [...movements.sortiesDefinitives, ...movements.disparusSansDate].filter((i) => (i.etpSuspenduAvant ?? 0) > 0);

  const hausses = movements.changementsTemps.filter((i) => (i.deltaEtp ?? 0) > 0).length;
  const baisses = movements.changementsTemps.length - hausses;
  const deltaTemps = movements.changementsTemps.reduce((s, i) => s + (i.deltaEtp ?? 0), 0);
  const hintTemps =
    movements.changementsTemps.length > 0
      ? `${hausses} hausse${hausses > 1 ? "s" : ""}, ${baisses} baisse${baisses > 1 ? "s" : ""}`
      : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ArrowLeftRight className="h-4 w-4" />
          Mouvements {moisPrecedentLabel} → {moisLabel} ({total} — {formatEtp(etpSousContrat)} sous contrat)
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Comparaison des photographies d&apos;effectif des deux mois. Une sortie ou un retour daté du
          dernier jour d&apos;un mois prend effet le mois suivant.
        </p>
      </CardHeader>
      <CardContent>
        <div className="max-h-[500px] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Salarié</TableHead>
                <TableHead className="text-xs">Type</TableHead>
                <TableHead className="text-xs">Équipe</TableHead>
                <TableHead className="text-xs">Motif / Taux</TableHead>
                <TableHead className="text-xs">Date / ETP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <CategorySection
                label="Nouveaux engagés"
                etp={etpCategorie(movements.nouveaux, 1)}
                color="text-green-700"
                icon="🟢"
                items={movements.nouveaux}
              />
              <CategorySection
                label="Retours de suspension"
                etp={etpCategorie(movements.retours, 1)}
                color="text-blue-700"
                icon="🔵"
                items={movements.retours}
              />
              <CategorySection
                label="Sorties définitives"
                etp={etpCategorie(movements.sortiesDefinitives, -1)}
                color="text-red-700"
                icon="🔴"
                items={movements.sortiesDefinitives}
              />
              <CategorySection
                label="Sorties temporaires"
                etp={etpCategorie(movements.sortiesTemporaires, -1)}
                color="text-amber-700"
                icon="🟡"
                items={movements.sortiesTemporaires}
              />
              <CategorySection
                label="Disparus du roster avant leur date de sortie prévue"
                etp={etpCategorie(movements.disparusSansDate, -1)}
                color="text-orange-700"
                icon="⚠️"
                items={movements.disparusSansDate}
                hint="aucune sortie constatée : à vérifier dans le SIRH"
                dateSuffix="(prévue)"
                masquerSiVide
              />
              <CategorySection
                label="Changements de temps de travail"
                etp={deltaTemps}
                color="text-violet-700"
                icon="🟣"
                items={movements.changementsTemps}
                hint={hintTemps}
              />
            </TableBody>
          </Table>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-sm">
          <span className="text-muted-foreground">
            Arrivées {signe(arrivees)} pers. ({formatEtp(etpCategorie([...movements.nouveaux, ...movements.retours], 1))})
          </span>
          <span className="text-muted-foreground">
            Sorties −{sorties} pers. ({formatEtp(etpCategorie([...movements.sortiesDefinitives, ...movements.sortiesTemporaires, ...movements.disparusSansDate], -1))})
          </span>
          <span className={`font-semibold ${solde < 0 ? "text-red-700" : solde > 0 ? "text-green-700" : ""}`}>
            Solde net {signe(solde)} pers.
          </span>
          <span className={`font-semibold ${etpSousContrat < 0 ? "text-red-700" : etpSousContrat > 0 ? "text-green-700" : ""}`}>
            Sous contrat {formatEtp(etpSousContrat)}
          </span>
          <span className={`font-semibold ${etpNet < 0 ? "text-red-700" : etpNet > 0 ? "text-green-700" : ""}`}>
            Après suspensions {formatEtp(etpNet)}
          </span>
        </div>
        <div className="mt-1 text-right text-xs text-muted-foreground">
          Sous contrat = nouveaux − sorties définitives − disparus + temps de travail, à rapprocher du 1er KPI.
          Après suspensions = idem + retours − suspensions
          {sortiesDejaSuspendues.length > 0 && (
            <>, hors {sortiesDejaSuspendues.length} sortie{sortiesDejaSuspendues.length > 1 ? "s" : ""} de salarié{sortiesDejaSuspendues.length > 1 ? "s" : ""} déjà en suspension ({formatEtp(sortiesDejaSuspendues.reduce((s, i) => s + (i.etpSuspenduAvant ?? 0), 0))})</>
          )}
          , à rapprocher du 2e KPI.
        </div>
      </CardContent>
    </Card>
  );
}
