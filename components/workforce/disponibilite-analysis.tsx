"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList } from "recharts";
import { FRENCH_MONTHS, FRENCH_MONTHS_SHORT } from "@/lib/constants";
import { CalendarRange } from "lucide-react";
import type { DisponibiliteAnnee } from "@/lib/utils/wp-disponibilite";

// Mêmes couleurs que les paliers du tableau de bord (ALL_SERIES)
const COULEURS = { sousContrat: "hsl(221, 83%, 53%)", apresMct: "hsl(330, 70%, 55%)", disponible: "hsl(30, 90%, 50%)" };

const fmtEtp = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtPct = (n: number) => `${n.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
const fmtInt = (n: number) => n.toLocaleString("fr-FR");
const ou = <T,>(v: T | null, f: (x: T) => string) => (v === null ? "—" : f(v));

interface Props {
  anneeInitiale?: number | null;
  analyses: DisponibiliteAnnee[];
}

/**
 * Effectif disponible après congés, par mois. Le disponible et les congés ne
 * s'affichent que sur les mois aux congés COMPLETS (congés des chauffeurs
 * importés) : jamais d'estimation.
 */
export function DisponibiliteAnalysis({ analyses, anneeInitiale }: Props) {
  const [annee, setAnnee] = useState(
    analyses.some((x) => x.annee === anneeInitiale) ? (anneeInitiale as number) : analyses[analyses.length - 1]?.annee
  );
  const a = analyses.find((x) => x.annee === annee) ?? analyses[analyses.length - 1];

  if (!a) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Aucun effectif à analyser.
      </div>
    );
  }

  const nbComplets = a.moisComplets.length;
  const base = nbComplets === 0
    ? "aucun mois aux congés complets"
    : `sur ${nbComplets} mois aux congés complets`;
  const tuiles: { label: string; valeur: string; detail: string }[] = [
    { label: "Disponible moyen", valeur: ou(a.disponibleMoyen, (v) => `${fmtEtp(v)} ETP`), detail: base },
    { label: "Taux de congés moyen", valeur: ou(a.tauxCongesMoyen, fmtPct), detail: "congés + extraordinaires et récup" },
    {
      label: "Mois le plus chargé en congés",
      valeur: a.moisPlusCharge ? FRENCH_MONTHS[a.moisPlusCharge.mois] : "—",
      detail: a.moisPlusCharge ? `${fmtEtp(a.moisPlusCharge.etp)} ETP en congé` : base,
    },
  ];

  const chartData = Array.from({ length: 12 }, (_, i) => {
    const m = a.parMois.find((x) => x.mois === i + 1);
    return {
      month: FRENCH_MONTHS_SHORT[i + 1],
      "Sous contrat": m?.sousContrat ?? null,
      "Après MCT": m?.apresMct ?? null,
      "Disponible (après congés)": m?.disponible ?? null,
    };
  });
  // Échelle resserrée sur les valeurs (et non depuis 0), arrondie à 50 ETP,
  // pour que les variations mensuelles se lisent.
  const valeurs = a.parMois.flatMap((m) => [m.sousContrat, m.apresMct, m.disponible ?? m.apresMct]);
  const pas = 50;
  const domaine: [number, number] = valeurs.length > 0
    ? [Math.max(0, Math.floor((Math.min(...valeurs) - pas) / pas) * pas), Math.ceil((Math.max(...valeurs) + pas / 2) / pas) * pas]
    : [0, pas];
  const tooltipStyle = { borderRadius: "8px", border: "1px solid var(--border)", backgroundColor: "var(--background)" };

  return (
    <div className="space-y-6">
      {analyses.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {analyses.map((x) => (
            <Button key={x.annee} size="sm" variant={x.annee === a.annee ? "default" : "outline"} onClick={() => setAnnee(x.annee)}>
              {x.annee}
            </Button>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarRange className="h-4 w-4" />
            Disponibilité {a.annee}
          </CardTitle>
          <CardDescription>
            Effectif disponible = après MCT − congés − congés extraordinaires et récup, mêmes définitions que le tableau de bord, mois par mois dans la photo du mois.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            {tuiles.map((t) => (
              <div key={t.label}>
                <p className="text-xs text-muted-foreground">{t.label}</p>
                <p className="text-xl font-bold">{t.valeur}</p>
                <p className="text-xs text-muted-foreground">{t.detail}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Effectif par mois (ETP)</CardTitle>
          <CardDescription>
            Disponible affiché uniquement pour les mois dont les congés des chauffeurs ont été importés.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} width={50} domain={domaine} allowDataOverflow />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${fmtEtp(Number(v))} ETP`} />
              <Legend />
              <Line type="monotone" dataKey="Sous contrat" stroke={COULEURS.sousContrat} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
              <Line type="monotone" dataKey="Après MCT" stroke={COULEURS.apresMct} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
              <Line type="monotone" dataKey="Disponible (après congés)" stroke={COULEURS.disponible} strokeWidth={2} dot={{ r: 4 }} connectNulls={false}>
                {/* Valeur du disponible sous chaque point, en encre de texte */}
                <LabelList
                  dataKey="Disponible (après congés)"
                  position="bottom"
                  offset={8}
                  formatter={(v) => (v === null || v === undefined ? "" : fmtEtp(Number(v)))}
                  className="fill-foreground"
                  fontSize={11}
                />
              </Line>
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Détail mensuel</CardTitle>
          <CardDescription>« — » : congés des chauffeurs non importés pour ce mois.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Mois</TableHead>
                <TableHead className="text-xs text-right">Sous contrat</TableHead>
                <TableHead className="text-xs text-right">Après MCT</TableHead>
                <TableHead className="text-xs text-right">Congés (h)</TableHead>
                <TableHead className="text-xs text-right">Congés (ETP)</TableHead>
                <TableHead className="text-xs text-right">Extra. et récup (h)</TableHead>
                <TableHead className="text-xs text-right">Extra. et récup (ETP)</TableHead>
                <TableHead className="text-xs text-right">Disponible</TableHead>
                <TableHead className="text-xs text-right">Taux de congés</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {a.parMois.map((m) => (
                <TableRow key={m.mois}>
                  <TableCell className="text-sm font-medium">{FRENCH_MONTHS[m.mois]}</TableCell>
                  <TableCell className="text-sm text-right">{fmtEtp(m.sousContrat)}</TableCell>
                  <TableCell className="text-sm text-right">{fmtEtp(m.apresMct)}</TableCell>
                  <TableCell className="text-sm text-right">{ou(m.heuresConges, fmtInt)}</TableCell>
                  <TableCell className="text-sm text-right">{ou(m.etpConges, fmtEtp)}</TableCell>
                  <TableCell className="text-sm text-right">{ou(m.heuresExtra, fmtInt)}</TableCell>
                  <TableCell className="text-sm text-right">{ou(m.etpExtra, fmtEtp)}</TableCell>
                  <TableCell className="text-sm text-right font-medium">{ou(m.disponible, fmtEtp)}</TableCell>
                  <TableCell className="text-sm text-right">{ou(m.tauxConges, fmtPct)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
