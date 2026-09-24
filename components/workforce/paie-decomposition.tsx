"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FAMILLES, type FamilleNature, type MontantsParFamille, type VentilationLigne } from "@/lib/utils/wp-natures-paie";
import { FRENCH_MONTHS_SHORT } from "@/lib/constants";
import { formatEuros } from "@/lib/utils/format";

/** Couleurs par famille, dans l'esprit des autres graphiques du module. */
const COULEURS: Record<FamilleNature, string> = {
  structurel: "hsl(221, 83%, 53%)",
  planning: "hsl(32, 95%, 50%)",
  primes: "hsl(262, 83%, 58%)",
  regularisations: "hsl(0, 84%, 60%)",
  soldes: "hsl(174, 60%, 40%)",
  avantages: "hsl(215, 16%, 60%)",
};

export interface PaieMoisPoint {
  mois: number;
  familles: MontantsParFamille;
  brut: number;
}

export interface NatureMontant {
  cle: string;
  libelle: string;
  famille: FamilleNature;
  montant: number;
}

interface Props {
  moisLabel: string;
  /** Les mois de l'année couverts par la Liste des salaires, dans le périmètre. */
  parMois: PaieMoisPoint[];
  /** Le mois affiché, null s'il n'est pas couvert. */
  duMois: { familles: MontantsParFamille; brut: number; n: number; nonPeriodiques: number } | null;
  natures: NatureMontant[];
  parDepot: VentilationLigne[];
  parFonction: VentilationLigne[];
  perimetreFiltre: boolean;
}

const pct = (part: number, total: number) => (total > 0 ? `${((part / total) * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %` : "—");
const signe = (n: number) => (n < 0 ? `−${formatEuros(Math.abs(n))}` : formatEuros(n));

function TableVentilation({ lignes, entete }: { lignes: VentilationLigne[]; entete: string }) {
  if (lignes.length === 0) return <p className="py-4 text-center text-sm text-muted-foreground">Pas de données.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-xs">{entete}</TableHead>
          <TableHead className="text-xs text-right">Lignes</TableHead>
          <TableHead className="text-xs text-right">Total brut</TableHead>
          <TableHead className="text-xs text-right">Structurel</TableHead>
          <TableHead className="text-xs text-right">Planning</TableHead>
          <TableHead className="text-xs text-right">Part planning</TableHead>
          <TableHead className="text-xs text-right">Primes</TableHead>
          <TableHead className="text-xs text-right">Régularisations</TableHead>
          <TableHead className="text-xs text-right">Soldes</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lignes.map((l) => (
          <TableRow key={l.cle}>
            <TableCell className="text-sm font-medium">{l.cle}</TableCell>
            <TableCell className="text-sm text-right">{l.n.toLocaleString("fr-FR")}</TableCell>
            <TableCell className="text-sm text-right font-medium">{formatEuros(l.brut)}</TableCell>
            <TableCell className="text-sm text-right">{formatEuros(l.familles.structurel)}</TableCell>
            <TableCell className="text-sm text-right">{formatEuros(l.familles.planning)}</TableCell>
            <TableCell className="text-sm text-right">{l.partPlanning != null ? `${l.partPlanning.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %` : "—"}</TableCell>
            <TableCell className="text-sm text-right">{formatEuros(l.familles.primes)}</TableCell>
            <TableCell className="text-sm text-right">{signe(l.familles.regularisations)}</TableCell>
            <TableCell className="text-sm text-right">{formatEuros(l.familles.soldes)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function PaieDecomposition({ moisLabel, parMois, duMois, natures, parDepot, parFonction, perimetreFiltre }: Props) {
  const data = parMois.map((p) => ({
    label: FRENCH_MONTHS_SHORT[p.mois],
    ...p.familles,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Décomposition de la paie — {moisLabel}</CardTitle>
        <CardDescription>
          Le total brut de la Liste des salaires, réparti par famille de natures{perimetreFiltre ? ", sur le périmètre filtré" : ""}.
          La part « pilotée par le planning » (nuit, dimanche, amplitudes, heures supplémentaires, fériés, dépannages) est ce que l&apos;organisation des tournées ajoute au contrat.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {duMois ? (
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3 lg:grid-cols-6">
            {FAMILLES.map((f) => (
              <div key={f.id} className="rounded-md border px-3 py-2" style={{ borderLeftColor: COULEURS[f.id], borderLeftWidth: 4 }} title={f.description}>
                <div className="text-xs text-muted-foreground">{f.libelle}</div>
                <div className="font-medium">{signe(duMois.familles[f.id])}</div>
                <div className="text-xs text-muted-foreground">{pct(duMois.familles[f.id], duMois.brut)} du brut</div>
              </div>
            ))}
            <div className="col-span-2 rounded-md border bg-slate-50 px-3 py-2 md:col-span-3 lg:col-span-6">
              <span className="text-xs text-muted-foreground">Total brut </span>
              <span className="font-medium">{formatEuros(duMois.brut)}</span>
              <span className="text-xs text-muted-foreground"> · {duMois.n.toLocaleString("fr-FR")} lignes{duMois.nonPeriodiques > 0 ? `, dont ${duMois.nonPeriodiques} non périodique${duMois.nonPeriodiques > 1 ? "s" : ""} (soldes de sortie)` : ""}</span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Aucune Liste des salaires importée pour {moisLabel}.</p>
        )}

        {data.length > 0 && (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 10 }} stackOffset="sign">
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => `${Math.round(v / 1000).toLocaleString("fr-FR")} k€`} width={70} />
              <Tooltip
                formatter={(value: number | string | undefined, name: string | undefined) => [signe(Number(value ?? 0)), name ?? ""]}
                contentStyle={{ borderRadius: "8px", border: "1px solid var(--border)", backgroundColor: "var(--background)" }}
              />
              <Legend />
              <ReferenceLine y={0} stroke="var(--border)" />
              {FAMILLES.map((f) => (
                <Bar key={f.id} dataKey={f.id} name={f.libelle} stackId="brut" fill={COULEURS[f.id]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}

        {duMois && (
          <Tabs defaultValue="natures">
            <TabsList className="mb-4">
              <TabsTrigger value="natures">Par nature</TabsTrigger>
              <TabsTrigger value="depot">Par dépôt</TabsTrigger>
              <TabsTrigger value="fonction">Par fonction</TabsTrigger>
            </TabsList>
            <TabsContent value="natures">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Nature</TableHead>
                    <TableHead className="text-xs">Famille</TableHead>
                    <TableHead className="text-xs text-right">Montant</TableHead>
                    <TableHead className="text-xs text-right">Part du brut</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="text-sm font-medium">Brut de base</TableCell>
                    <TableCell className="text-sm">Structurel</TableCell>
                    <TableCell className="text-sm text-right font-medium">{formatEuros(duMois.familles.structurel - natures.filter((n) => n.famille === "structurel").reduce((s, n) => s + n.montant, 0))}</TableCell>
                    <TableCell className="text-sm text-right">{pct(duMois.familles.structurel - natures.filter((n) => n.famille === "structurel").reduce((s, n) => s + n.montant, 0), duMois.brut)}</TableCell>
                  </TableRow>
                  {natures.map((n) => (
                    <TableRow key={n.cle}>
                      <TableCell className="text-sm">{n.libelle}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{FAMILLES.find((f) => f.id === n.famille)?.libelle}</TableCell>
                      <TableCell className="text-sm text-right">{signe(n.montant)}</TableCell>
                      <TableCell className="text-sm text-right">{pct(n.montant, duMois.brut)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>
            <TabsContent value="depot">
              <p className="mb-2 text-xs text-muted-foreground">Dépôt lu dans le roster du mois (service) ; les salariés absents de la photo sont regroupés.</p>
              <TableVentilation lignes={parDepot} entete="Dépôt" />
            </TabsContent>
            <TabsContent value="fonction">
              <p className="mb-2 text-xs text-muted-foreground">Fonction telle que la paie la porte.</p>
              <TableVentilation lignes={parFonction} entete="Fonction" />
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
