"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FRENCH_MONTHS_SHORT } from "@/lib/constants";
import { formatEuros } from "@/lib/utils/format";
import type { AgregatSixiemesJours, SixiemesJoursPeriode, TrancheSixiemesJours, VentilationSixiemesJours } from "@/lib/utils/wp-sixiemes-jours";

const COULEUR_JOURS = "hsl(262, 83%, 58%)";
const COULEUR_CONCERNES = "hsl(221, 83%, 53%)";

interface Props {
  moisLabel: string;
  /** Les périodes réglées connues de la paie, dans le périmètre. */
  periodes: SixiemesJoursPeriode[];
  /** La dernière période réglée à la paie du mois affiché, null si sa paie n'est pas importée. */
  selection: SixiemesJoursPeriode | null;
  tranches: TrancheSixiemesJours[];
  parDepot: VentilationSixiemesJours[];
  parFonction: VentilationSixiemesJours[];
  perimetreFiltre: boolean;
}

const entier = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 0 });
const decimal = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
const pct = (part: number, total: number) => (total > 0 ? `${((part / total) * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %` : "—");
const styleTooltip = { borderRadius: "8px", border: "1px solid var(--border)", backgroundColor: "var(--background)" };

function Tuile({ libelle, valeur, note, couleur }: { libelle: string; valeur: string; note?: string; couleur?: string }) {
  return (
    <div className="rounded-md border px-3 py-2" style={couleur ? { borderLeft: `4px solid ${couleur}` } : undefined}>
      <div className="text-xs text-muted-foreground">{libelle}</div>
      <div className="text-lg font-semibold">{valeur}</div>
      {note && <div className="text-xs text-muted-foreground">{note}</div>}
    </div>
  );
}

/** Jours rapportés aux chauffeurs payés du groupe (concernés ou non). */
const parChauffeur = (jours: number, chauffeurs: number) => (chauffeurs > 0 ? jours / chauffeurs : null);
const ratio = (n: number | null) => (n == null ? "—" : n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/**
 * Comparaison des groupes à effectif égal : chaque groupe est rapporté à SES
 * chauffeurs payés, la ligne « Moyenne » rapporte tout le périmètre aux siens.
 * Trié du plus exposé au moins exposé.
 */
function TableVentilation({ lignes, entete, ensemble }: { lignes: VentilationSixiemesJours[]; entete: string; ensemble: AgregatSixiemesJours }) {
  if (lignes.length === 0) return <p className="py-4 text-center text-sm text-muted-foreground">Pas de jour supplémentaire sur cette période.</p>;
  const moyenne = parChauffeur(ensemble.jours, ensemble.chauffeurs);
  const tries = [...lignes].sort((a, b) => (parChauffeur(b.jours, b.chauffeurs) ?? -1) - (parChauffeur(a.jours, a.chauffeurs) ?? -1));
  const ligne = (l: AgregatSixiemesJours, cle: string, estMoyenne = false) => {
    const taux = parChauffeur(l.jours, l.chauffeurs);
    const ecart = !estMoyenne && taux != null && moyenne ? ((taux - moyenne) / moyenne) * 100 : null;
    const classe = estMoyenne ? "text-sm text-right font-semibold" : "text-sm text-right";
    return (
      <TableRow key={cle} className={estMoyenne ? "border-t-2 bg-slate-50" : undefined}>
        <TableCell className={estMoyenne ? "text-sm font-semibold" : "text-sm font-medium"}>{cle}</TableCell>
        <TableCell className={classe}>{entier(l.chauffeurs)}</TableCell>
        <TableCell className={classe}>{pct(l.concernes, l.chauffeurs)}</TableCell>
        <TableCell className={classe}>{entier(l.jours)}</TableCell>
        <TableCell className={`${classe} font-semibold`}>{ratio(taux)}</TableCell>
        <TableCell className={classe}>
          {ecart == null ? (estMoyenne ? "référence" : "—") : (
            <span className={ecart >= 15 ? "font-medium text-red-600" : ecart <= -15 ? "text-emerald-700" : "text-muted-foreground"}>
              {ecart >= 0 ? "+" : "−"}{Math.abs(ecart).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} %
            </span>
          )}
        </TableCell>
        <TableCell className={classe}>{l.chauffeurs > 0 ? formatEuros(l.montant / l.chauffeurs) : "—"}</TableCell>
      </TableRow>
    );
  };
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-xs">{entete}</TableHead>
          <TableHead className="text-xs text-right">Chauffeurs payés</TableHead>
          <TableHead className="text-xs text-right">Part concernée</TableHead>
          <TableHead className="text-xs text-right">Jours</TableHead>
          <TableHead className="text-xs text-right">Jours par chauffeur</TableHead>
          <TableHead className="text-xs text-right">Écart à la moyenne</TableHead>
          <TableHead className="text-xs text-right">Montant par chauffeur</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tries.map((l) => ligne(l, l.cle))}
        {ligne(ensemble, "Moyenne du périmètre", true)}
      </TableBody>
    </Table>
  );
}

/** Barres horizontales, une par groupe, et la moyenne en trait vertical. */
function GraphiqueParChauffeur({ lignes, ensemble }: { lignes: VentilationSixiemesJours[]; ensemble: AgregatSixiemesJours }) {
  const moyenne = parChauffeur(ensemble.jours, ensemble.chauffeurs);
  const data = lignes
    .filter((l) => l.chauffeurs > 0)
    .map((l) => ({ cle: l.cle.replace(/^Depots? - /i, ""), jours: parChauffeur(l.jours, l.chauffeurs) ?? 0, chauffeurs: l.chauffeurs }))
    .sort((a, b) => b.jours - a.jours);
  if (data.length === 0) return null;
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 34 + 60)}>
      <BarChart data={data} layout="vertical" margin={{ top: 20, right: 30, bottom: 5, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={(v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} />
        <YAxis type="category" dataKey="cle" tick={{ fontSize: 12 }} width={190} />
        <Tooltip
          contentStyle={styleTooltip}
          labelFormatter={(label, payload) => {
            const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
            return p ? `${label} — ${entier(p.chauffeurs)} chauffeurs payés` : String(label);
          }}
          formatter={(value: number | string | undefined) => [ratio(Number(value ?? 0)), "Jours par chauffeur"]}
        />
        <Bar dataKey="jours" name="Jours supplémentaires par chauffeur" fill={COULEUR_JOURS} />
        {moyenne != null && (
          <ReferenceLine x={moyenne} stroke="var(--foreground)" strokeDasharray="4 4" label={{ value: `Moyenne ${ratio(moyenne)}`, position: "top", fontSize: 11 }} />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SixiemesJours({ moisLabel, periodes, selection, tranches, parDepot, parFonction, perimetreFiltre }: Props) {
  const evolution = periodes.map((p) => ({
    label: `P${p.numero} ${p.annee}`,
    libelle: p.libelle,
    paie: `${FRENCH_MONTHS_SHORT[p.moisPaie]} ${p.anneePaie}`,
    jours: p.jours,
    concernes: p.concernes,
    montant: p.montant,
  }));
  const precedente = selection ? periodes[periodes.findIndex((p) => p.annee === selection.annee && p.numero === selection.numero) - 1] : undefined;
  const ecart = selection && precedente ? selection.jours - precedente.jours : null;

  return (
    <Card id="sixiemes-jours">
      <CardHeader>
        <CardTitle className="text-base">Jours supplémentaires de travail — par période de référence</CardTitle>
        <CardDescription>
          La prime de 6e jour (PRR) de la Liste des salaires{perimetreFiltre ? ", sur le périmètre filtré" : ""}, 80 € le jour, réglée sur la paie qui suit la fin de chaque période : janvier pour septembre–décembre, mai pour janvier–avril, septembre pour mai–août.
          Les rattrapages des mois suivants sont rattachés à la même période. Le nombre de jours d&apos;un salarié est son montant divisé par 80 €.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {selection ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Dernière période réglée à la paie de {moisLabel} : {selection.libelle}, payée en {FRENCH_MONTHS_SHORT[selection.moisPaie]} {selection.anneePaie}.</p>
            <div className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
              <Tuile
                libelle="Jours supplémentaires"
                valeur={entier(selection.jours)}
                note={ecart != null && precedente ? `${ecart >= 0 ? "+" : "−"}${entier(Math.abs(ecart))} vs P${precedente.numero} ${precedente.annee}` : undefined}
                couleur={COULEUR_JOURS}
              />
              <Tuile
                libelle="Chauffeurs concernés"
                valeur={entier(selection.concernes)}
                note={`${pct(selection.concernes, selection.chauffeurs)} des ${entier(selection.chauffeurs)} chauffeurs payés`}
                couleur={COULEUR_CONCERNES}
              />
              <Tuile libelle="Jours par concerné" valeur={selection.concernes > 0 ? decimal(selection.jours / selection.concernes) : "—"} />
              <Tuile libelle="Montant versé" valeur={formatEuros(selection.montant)} note="80 € le jour" />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">La paie qui règle la dernière période close avant {moisLabel} n&apos;est pas importée.</p>
        )}

        {evolution.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-medium">Jours supplémentaires par période de référence</h3>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={evolution} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis yAxisId="j" tick={{ fontSize: 12 }} width={50} />
                <YAxis yAxisId="c" orientation="right" tick={{ fontSize: 12 }} width={45} />
                <Tooltip
                  contentStyle={styleTooltip}
                  labelFormatter={(label, payload) => {
                    const p = payload?.[0]?.payload as (typeof evolution)[number] | undefined;
                    return p ? `${p.libelle} — payée en ${p.paie} — ${formatEuros(p.montant)}` : String(label);
                  }}
                  formatter={(value: number | string | undefined, name: string | undefined) => [entier(Number(value ?? 0)), name ?? ""]}
                />
                <Legend />
                <Bar yAxisId="j" dataKey="jours" name="Jours supplémentaires" fill={COULEUR_JOURS} />
                <Line yAxisId="c" dataKey="concernes" name="Chauffeurs concernés (axe de droite)" stroke={COULEUR_CONCERNES} strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
            {evolution.length < 3 && (
              <p className="text-xs text-muted-foreground">Peu de périodes dans la paie importée : l&apos;évolution s&apos;allongera à chaque nouvelle Liste des salaires.</p>
            )}
          </div>
        )}

        {selection && (
          <div>
            <h3 className="mb-2 text-sm font-medium">Chauffeurs selon leur nombre de jours supplémentaires — {selection.libelle}</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={tranches} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="libelle" tick={{ fontSize: 12 }} label={{ value: "jours supplémentaires sur la période", position: "insideBottom", offset: -2, fontSize: 11 }} height={40} />
                <YAxis tick={{ fontSize: 12 }} width={50} allowDecimals={false} />
                <Tooltip
                  contentStyle={styleTooltip}
                  labelFormatter={(label) => `${label} jour(s)`}
                  formatter={(value: number | string | undefined) => [`${entier(Number(value ?? 0))} chauffeurs`, ""]}
                />
                <Bar dataKey="salaries" name="Chauffeurs" fill={COULEUR_JOURS} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {selection && (
          <Tabs defaultValue="depot">
            <TabsList className="mb-4">
              <TabsTrigger value="depot">Par dépôt</TabsTrigger>
              <TabsTrigger value="fonction">Par fonction</TabsTrigger>
            </TabsList>
            <TabsContent value="depot">
              <p className="mb-2 text-xs text-muted-foreground">
                Chaque dépôt est rapporté à SES chauffeurs payés au mois du règlement, concernés ou non : à effectif égal, les dépôts se comparent directement. La moyenne rapporte tout le périmètre à ses chauffeurs ; un écart de plus de 15 % est mis en évidence.
                Dépôt lu dans le roster du dernier mois de la période ; les dépôts de moins de 3 concernés sont regroupés, pour qu&apos;aucune prime individuelle ne se lise. Un chauffeur à temps partiel compte pour un.
              </p>
              <GraphiqueParChauffeur lignes={parDepot} ensemble={selection} />
              <TableVentilation lignes={parDepot} entete="Dépôt" ensemble={selection} />
            </TabsContent>
            <TabsContent value="fonction">
              <p className="mb-2 text-xs text-muted-foreground">Fonctions de chauffeur telles que la paie les porte ; les rares autres fonctions concernées (formateurs…) restent dans les totaux de la période.</p>
              <TableVentilation lignes={parFonction} entete="Fonction" ensemble={selection} />
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
