"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FAMILLES, FAMILLES_VERSEES, type FamilleNature, type MontantsParFamille, type VentilationLigne } from "@/lib/utils/wp-natures-paie";
import { FRENCH_MONTHS_SHORT } from "@/lib/constants";
import { formatEuros } from "@/lib/utils/format";
import { PaieCase, type DetailCase, type DetailLigne } from "@/components/workforce/paie-case";

/** Couleurs par famille, dans l'esprit des autres graphiques du module. */
const COULEURS: Record<FamilleNature, string> = {
  structurel: "hsl(221, 83%, 53%)",
  planning: "hsl(32, 95%, 50%)",
  primes: "hsl(262, 83%, 58%)",
  regularisations: "hsl(0, 84%, 60%)",
  soldes: "hsl(174, 60%, 40%)",
  avantages: "hsl(215, 16%, 60%)",
  non_verse: "hsl(215, 14%, 80%)",
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
  /** Versements calendaires du mois (décompte de période, bonus, 13e mois), null un mois ordinaire. */
  mentionCalendrier?: string | null;
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
          <TableHead className="text-xs text-right">Brut versé</TableHead>
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

/**
 * Détail d'une famille : ses natures, puis sa répartition par dépôt et par
 * fonction. Les parts sont exprimées sur le montant de la FAMILLE (le bloc
 * affiche déjà sa part du brut).
 */
function detailFamille(
  famille: FamilleNature,
  duMois: { familles: MontantsParFamille; brut: number },
  natures: NatureMontant[],
  parDepot: VentilationLigne[],
  parFonction: VentilationLigne[],
): DetailCase {
  const total = duMois.familles[famille];
  const part = (n: number) => (Math.abs(total) >= 0.005 ? (n / total) * 100 : null);
  const naturesFamille = natures.filter((n) => n.famille === famille);
  const lignesNatures: DetailLigne[] = naturesFamille.map((n) => ({ libelle: n.libelle, montant: n.montant, part: part(n.montant) }));
  if (famille === "structurel") {
    const base = total - naturesFamille.reduce((acc, n) => acc + n.montant, 0);
    lignesNatures.unshift({ libelle: "Brut de base", montant: base, part: part(base) });
  }
  const repartition = (lignes: VentilationLigne[]): DetailLigne[] =>
    lignes
      .map((l) => ({ libelle: l.cle, montant: l.familles[famille], part: part(l.familles[famille]) }))
      .filter((l) => Math.abs(l.montant) >= 0.005)
      .sort((a, b) => Math.abs(b.montant) - Math.abs(a.montant));
  const depots = repartition(parDepot);
  const fonctions = repartition(parFonction);
  return {
    sousTitre: FAMILLES.find((f) => f.id === famille)?.description,
    sections: [
      { titre: "Par nature", montant: total, ouvert: true, lignes: lignesNatures },
      { titre: `Par dépôt (${depots.length})`, lignes: depots },
      { titre: `Par fonction (${fonctions.length})`, lignes: fonctions },
    ],
    note: "Parts exprimées sur le montant de la famille.",
    lien: { href: "#decomposition-paie-tableaux", libelle: "Voir les tableaux par nature, dépôt et fonction" },
  };
}

export function PaieDecomposition({ moisLabel, mentionCalendrier, parMois, duMois, natures, parDepot, parFonction, perimetreFiltre }: Props) {
  const data = parMois.map((p) => ({
    label: FRENCH_MONTHS_SHORT[p.mois],
    ...p.familles,
  }));

  return (
    <Card id="decomposition-paie">
      <CardHeader>
        <CardTitle className="text-base">Décomposition de la paie — {moisLabel}</CardTitle>
        <CardDescription>
          Le brut versé de la Liste des salaires, réparti par famille de natures{perimetreFiltre ? ", sur le périmètre filtré" : ""} ; l&apos;avantage en nature voiture, valorisé dans le brut pour l&apos;impôt mais retenu sur le net, en est exclu.
          La part « liée au planning » (nuit, dimanche, amplitudes, heures supplémentaires, fériés, dépannages) est ce que les horaires de service ajoutent au contrat — en grande partie subie : fériés, dimanches et nuits ne se choisissent pas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {duMois && mentionCalendrier && (
          <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">{mentionCalendrier}</p>
        )}
        {duMois ? (
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3 lg:grid-cols-6">
            {FAMILLES_VERSEES.map((f) => (
              <PaieCase
                key={f.id}
                libelle={f.libelle}
                valeur={duMois.familles[f.id]}
                note={`${pct(duMois.familles[f.id], duMois.brut)} du brut versé`}
                couleur={COULEURS[f.id]}
                detail={detailFamille(f.id, duMois, natures, parDepot, parFonction)}
              />
            ))}
            <div className="col-span-2 rounded-md border bg-slate-50 px-3 py-2 md:col-span-3 lg:col-span-6">
              <span className="text-xs text-muted-foreground">Brut versé </span>
              <span className="font-medium">{formatEuros(duMois.brut)}</span>
              <span className="text-xs text-muted-foreground"> · {duMois.n.toLocaleString("fr-FR")} lignes{duMois.nonPeriodiques > 0 ? `, dont ${duMois.nonPeriodiques} non périodique${duMois.nonPeriodiques > 1 ? "s" : ""} (soldes de sortie)` : ""}</span>
              {Math.abs(duMois.familles.non_verse) >= 0.5 && (
                <span className="block text-xs text-muted-foreground md:inline" title={FAMILLES.find((f) => f.id === "non_verse")?.description}>
                  {" "}· hors avantage en nature non versé {formatEuros(duMois.familles.non_verse)} (total brut fiscal {formatEuros(duMois.brut + duMois.familles.non_verse)})
                </span>
              )}
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
              {FAMILLES_VERSEES.map((f) => (
                <Bar key={f.id} dataKey={f.id} name={f.libelle} stackId="brut" fill={COULEURS[f.id]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}

        {duMois && (
          <Tabs defaultValue="natures" id="decomposition-paie-tableaux">
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
                    <TableHead className="text-xs text-right">Part du brut versé</TableHead>
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
                      <TableCell className="text-sm text-right">{n.famille === "non_verse" ? "non versé" : pct(n.montant, duMois.brut)}</TableCell>
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
