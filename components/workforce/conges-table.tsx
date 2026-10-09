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
import { CalendarRange, ChevronRight, ChevronDown } from "lucide-react";
import { LIBELLES_PRESTATION_CONGE } from "@/lib/utils/wp-conges";

export interface CongeItem {
  code_salarie: string;
  nom_salarie: string;
  vehicle_type: string;
  description_equipe: string;
  prestation: string;
  categorie: string;
  total_hrs: number;
  nb_jours: number;
  etp_perdu: number;
}

interface Groupe {
  key: string;
  label: string;
  items: CongeItem[];
  totalHrs: number;
  totalEtp: number;
}

const arrondi1 = (n: number) => Math.round(n * 10) / 10;

function groupe(key: string, label: string, items: CongeItem[]): Groupe {
  return {
    key,
    label,
    items,
    totalHrs: arrondi1(items.reduce((s, d) => s + d.total_hrs, 0)),
    totalEtp: arrondi1(items.reduce((s, d) => s + d.etp_perdu, 0)),
  };
}

/** Extraordinaires et récup : un groupe par code (déménagement, décès, noces, récupération). */
function groupesParCode(items: CongeItem[]): Groupe[] {
  const map = new Map<string, CongeItem[]>();
  for (const item of items) {
    const arr = map.get(item.prestation) || [];
    arr.push(item);
    map.set(item.prestation, arr);
  }
  return [...map.entries()]
    .map(([code, groupItems]) => groupe(code, LIBELLES_PRESTATION_CONGE[code] ?? code, groupItems))
    .sort((a, b) => b.totalHrs - a.totalHrs);
}

function EmployeeRows({ items }: { items: CongeItem[] }) {
  const sorted = [...items].sort((a, b) => b.total_hrs - a.total_hrs);
  return (
    <>
      {sorted.map((d, i) => (
        <TableRow key={`${d.code_salarie}-${d.prestation}-${i}`}>
          <TableCell className="text-sm font-medium pl-12">{d.code_salarie}</TableCell>
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

function GroupeSection({ group }: { group: Groupe }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => setOpen(!open)}>
        <TableCell colSpan={7} className="pl-4">
          <div className="flex items-center gap-2">
            {open ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="text-sm font-medium text-orange-600">{group.label}</span>
            <Badge variant="secondary" className="text-xs ml-1">
              {group.items.length} pers.
            </Badge>
            <span className="text-xs text-muted-foreground ml-auto">
              {group.totalHrs}h — {group.totalEtp} ETP
            </span>
          </div>
        </TableCell>
      </TableRow>
      {open && <EmployeeRows items={group.items} />}
    </>
  );
}

function EnTeteSection({ libelle, groupes }: { libelle: string; groupes: Groupe[] }) {
  const heures = arrondi1(groupes.reduce((s, g) => s + g.totalHrs, 0));
  const etp = arrondi1(groupes.reduce((s, g) => s + g.totalEtp, 0));
  return (
    <TableRow className="bg-muted/40 hover:bg-muted/40">
      <TableCell colSpan={7} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {libelle} — {heures}h — {etp} ETP
      </TableCell>
    </TableRow>
  );
}

/**
 * Détail des congés du mois, par salarié : d'abord les congés, puis les
 * congés extraordinaires et la récupération par code. Ce ne sont pas des
 * absences : ils ne comptent pas dans le taux d'absentéisme global.
 */
export function CongesTable({
  items,
  totalHrs,
  etpTotal,
  complet,
}: {
  items: CongeItem[];
  totalHrs: number;
  etpTotal: number;
  /** Congés du mois complets (chauffeurs importés) ; false = supports seuls. */
  complet: boolean;
}) {
  const conges = items.filter((i) => i.categorie === "conges");
  const extra = items.filter((i) => i.categorie === "extraordinaire");
  const groupesConges = conges.length > 0 ? [groupe("CONGES", "Congés", conges)] : [];
  const groupesExtra = groupesParCode(extra);
  const personnes = new Set(items.map((i) => i.code_salarie)).size;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarRange className="h-4 w-4" />
          Détail des congés du mois ({personnes} pers. — {totalHrs}h — {etpTotal.toFixed(1)} ETP)
        </CardTitle>
        {items.length > 0 && !complet && (
          <p className="text-xs font-medium text-amber-600">
            Partiel — les congés des chauffeurs ne sont pas encore importés pour ce mois.
          </p>
        )}
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Aucun congé importé pour ce mois.
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
                  <TableHead className="text-xs text-right">ETP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupesConges.length > 0 && <EnTeteSection libelle="Congés" groupes={groupesConges} />}
                {groupesConges.map((g) => (
                  <GroupeSection key={g.key} group={g} />
                ))}
                {groupesExtra.length > 0 && <EnTeteSection libelle="Congés extraordinaires et récup" groupes={groupesExtra} />}
                {groupesExtra.map((g) => (
                  <GroupeSection key={g.key} group={g} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
