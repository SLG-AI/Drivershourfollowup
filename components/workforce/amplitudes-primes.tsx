"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FRENCH_MONTHS_SHORT } from "@/lib/constants";
import { formatEuros } from "@/lib/utils/format";
import type { AgregatAmplitude, AmplitudeMois, TrancheAmplitude, VentilationAmplitude } from "@/lib/utils/wp-amplitudes";

/** Les deux paliers, dans l'esprit de la famille « planning » (orange). */
const COULEUR_AM1 = "hsl(32, 95%, 50%)";
const COULEUR_AM2 = "hsl(8, 78%, 45%)";
const COULEUR_CONCERNES = "hsl(221, 83%, 53%)";

interface Props {
  /** Année de paie affichée. */
  annee: number;
  moisLabel: string;
  /** Les mois de paie de l'année, dans le périmètre. */
  parMois: AmplitudeMois[];
  /** Le mois de paie affiché, null s'il n'est pas couvert. */
  duMois: AmplitudeMois | null;
  tranches: TrancheAmplitude[];
  parDepot: VentilationAmplitude[];
  parFonction: VentilationAmplitude[];
  perimetreFiltre: boolean;
}

const entier = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 0 });
const pct = (part: number, total: number) => (total > 0 ? `${((part / total) * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %` : "—");

/** La paie d'un mois porte les amplitudes du mois PRÉCÉDENT. */
function moisActivite(moisPaie: number, anneePaie: number) {
  return moisPaie === 1 ? { mois: 12, annee: anneePaie - 1 } : { mois: moisPaie - 1, annee: anneePaie };
}
const libelleActivite = (moisPaie: number, anneePaie: number) => {
  const a = moisActivite(moisPaie, anneePaie);
  return `${FRENCH_MONTHS_SHORT[a.mois]} ${a.annee}`;
};

function Tuile({ libelle, valeur, note, couleur }: { libelle: string; valeur: string; note?: string; couleur?: string }) {
  return (
    <div className="rounded-md border px-3 py-2" style={couleur ? { borderLeft: `4px solid ${couleur}` } : undefined}>
      <div className="text-xs text-muted-foreground">{libelle}</div>
      <div className="text-lg font-semibold">{valeur}</div>
      {note && <div className="text-xs text-muted-foreground">{note}</div>}
    </div>
  );
}

/** Journées longues rapportées aux chauffeurs payés du groupe (concernés ou non). */
const parChauffeur = (journees: number, chauffeurs: number) => (chauffeurs > 0 ? journees / chauffeurs : null);
const ratio = (n: number | null) => (n == null ? "—" : n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const ecartMoyenne = (n: number | null, moyenne: number | null) => {
  if (n == null || moyenne == null || moyenne === 0) return null;
  return ((n - moyenne) / moyenne) * 100;
};

/**
 * Comparaison des groupes à charge égale : chaque groupe est rapporté à SES
 * chauffeurs payés, et la ligne « Moyenne » rapporte tout le périmètre aux
 * siens (moyenne pondérée, chauffeurs sans dépôt compris). Trié du plus exposé
 * au moins exposé.
 */
function TableVentilation({ lignes, entete, ensemble }: { lignes: VentilationAmplitude[]; entete: string; ensemble: AmplitudeMois }) {
  if (lignes.length === 0) return <p className="py-4 text-center text-sm text-muted-foreground">Pas de journée longue ce mois-ci.</p>;
  const moyenne = parChauffeur(ensemble.journeesAm1 + ensemble.journeesAm2, ensemble.chauffeurs);
  const tries = [...lignes].sort((a, b) => (parChauffeur(b.journeesAm1 + b.journeesAm2, b.chauffeurs) ?? -1) - (parChauffeur(a.journeesAm1 + a.journeesAm2, a.chauffeurs) ?? -1));
  const ligne = (l: AgregatAmplitude, cle: string, estMoyenne = false) => {
    const total = parChauffeur(l.journeesAm1 + l.journeesAm2, l.chauffeurs);
    const ecart = estMoyenne ? null : ecartMoyenne(total, moyenne);
    const classe = estMoyenne ? "text-sm text-right font-semibold" : "text-sm text-right";
    return (
      <TableRow key={cle} className={estMoyenne ? "border-t-2 bg-slate-50" : undefined}>
        <TableCell className={estMoyenne ? "text-sm font-semibold" : "text-sm font-medium"}>{cle}</TableCell>
        <TableCell className={classe}>{entier(l.chauffeurs)}</TableCell>
        <TableCell className={classe}>{pct(l.concernes, l.chauffeurs)}</TableCell>
        <TableCell className={classe}>{ratio(parChauffeur(l.journeesAm1, l.chauffeurs))}</TableCell>
        <TableCell className={classe}>{ratio(parChauffeur(l.journeesAm2, l.chauffeurs))}</TableCell>
        <TableCell className={`${classe} font-semibold`}>{ratio(total)}</TableCell>
        <TableCell className={classe}>
          {ecart == null ? (estMoyenne ? "référence" : "—") : (
            <span className={ecart >= 15 ? "font-medium text-red-600" : ecart <= -15 ? "text-emerald-700" : "text-muted-foreground"}>
              {ecart >= 0 ? "+" : "−"}{Math.abs(ecart).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} %
            </span>
          )}
        </TableCell>
        <TableCell className={classe}>{l.chauffeurs > 0 ? formatEuros((l.am1 + l.am2) / l.chauffeurs) : "—"}</TableCell>
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
          <TableHead className="text-xs text-right">11–12 h par chauffeur</TableHead>
          <TableHead className="text-xs text-right">&gt; 12 h par chauffeur</TableHead>
          <TableHead className="text-xs text-right">Journées longues par chauffeur</TableHead>
          <TableHead className="text-xs text-right">Écart à la moyenne</TableHead>
          <TableHead className="text-xs text-right">Coût par chauffeur</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tries.map((l) => ligne(l, l.cle))}
        {ligne(ensemble, "Moyenne du périmètre", true)}
      </TableBody>
    </Table>
  );
}

/** Barres horizontales empilées, une par groupe, et la moyenne en trait vertical. */
function GraphiqueParChauffeur({ lignes, ensemble }: { lignes: VentilationAmplitude[]; ensemble: AmplitudeMois }) {
  const moyenne = parChauffeur(ensemble.journeesAm1 + ensemble.journeesAm2, ensemble.chauffeurs);
  const data = lignes
    .filter((l) => l.chauffeurs > 0)
    .map((l) => ({
      cle: l.cle.replace(/^Depots? - /i, ""),
      am1: parChauffeur(l.journeesAm1, l.chauffeurs) ?? 0,
      am2: parChauffeur(l.journeesAm2, l.chauffeurs) ?? 0,
      chauffeurs: l.chauffeurs,
    }))
    .sort((a, b) => b.am1 + b.am2 - (a.am1 + a.am2));
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
            return p ? `${label} — ${entier(p.chauffeurs)} chauffeurs payés — ${ratio(p.am1 + p.am2)} journées longues par chauffeur` : String(label);
          }}
          formatter={(value: number | string | undefined, name: string | undefined) => [ratio(Number(value ?? 0)), name ?? ""]}
        />
        <Legend />
        <Bar dataKey="am1" name="11 à 12 h par chauffeur" stackId="j" fill={COULEUR_AM1} />
        <Bar dataKey="am2" name="Plus de 12 h par chauffeur" stackId="j" fill={COULEUR_AM2} />
        {moyenne != null && (
          <ReferenceLine x={moyenne} stroke="var(--foreground)" strokeDasharray="4 4" label={{ value: `Moyenne ${ratio(moyenne)}`, position: "top", fontSize: 11 }} />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}

const styleTooltip = { borderRadius: "8px", border: "1px solid var(--border)", backgroundColor: "var(--background)" };

export function AmplitudesPrimes({ annee, moisLabel, parMois, duMois, tranches, parDepot, parFonction, perimetreFiltre }: Props) {
  const evolution = parMois.map((m) => ({
    label: libelleActivite(m.mois, annee),
    paie: `${FRENCH_MONTHS_SHORT[m.mois]} ${annee}`,
    journeesAm1: m.journeesAm1,
    journeesAm2: m.journeesAm2,
    concernes: m.concernes,
    cout: m.am1 + m.am2,
  }));
  const journeesDuMois = duMois ? duMois.journeesAm1 + duMois.journeesAm2 : 0;

  return (
    <Card id="amplitudes">
      <CardHeader>
        <CardTitle className="text-base">Amplitudes de service — paie de {moisLabel}</CardTitle>
        <CardDescription>
          Sans horaires de prise et de fin de service, les amplitudes se lisent dans les primes de la Liste des salaires{perimetreFiltre ? ", sur le périmètre filtré" : ""} : « Amplitude &gt; 11 h » (AM1) et « Amplitude &gt; 12 h » (AM2), payées par journée.
          Le nombre de journées est le montant divisé par le taux du mois (le montant le plus fréquent) ; les paliers sont exclusifs, une journée de plus de 12 h ne touche que la seconde prime.
          La paie d&apos;un mois porte les amplitudes du mois précédent : les graphiques sont datés au mois d&apos;activité. On sait combien de journées dépassent 11 h et 12 h, pas leur durée exacte.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {duMois ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Activité de {libelleActivite(duMois.mois, annee)} :</p>
            <div className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
              <Tuile
                libelle="Chauffeurs concernés"
                valeur={entier(duMois.concernes)}
                note={`${pct(duMois.concernes, duMois.chauffeurs)} des ${entier(duMois.chauffeurs)} chauffeurs payés`}
                couleur={COULEUR_CONCERNES}
              />
              <Tuile
                libelle="Journées de 11 à 12 h"
                valeur={entier(duMois.journeesAm1)}
                note={`${entier(duMois.concernesAm1)} chauffeurs · ${pct(duMois.concernesAm1, duMois.chauffeurs)} des chauffeurs payés`}
                couleur={COULEUR_AM1}
              />
              <Tuile
                libelle="Journées de plus de 12 h"
                valeur={entier(duMois.journeesAm2)}
                note={`${entier(duMois.concernesAm2)} chauffeurs · ${pct(duMois.concernesAm2, duMois.chauffeurs)} des chauffeurs payés`}
                couleur={COULEUR_AM2}
              />
              <Tuile
                libelle="Journées longues par concerné"
                valeur={duMois.concernes > 0 ? (journeesDuMois / duMois.concernes).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) : "—"}
                note={`${duMois.chauffeurs > 0 ? (journeesDuMois / duMois.chauffeurs).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) : "—"} par chauffeur payé · ${pct(duMois.journeesAm2, journeesDuMois)} au-delà de 12 h`}
              />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Aucune Liste des salaires importée pour {moisLabel}.</p>
        )}

        {evolution.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-medium">Journées longues par mois d&apos;activité</h3>
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
                    return p ? `Activité de ${label} — paie de ${p.paie} — ${formatEuros(p.cout)}` : String(label);
                  }}
                  formatter={(value: number | string | undefined, name: string | undefined) => [entier(Number(value ?? 0)), name ?? ""]}
                />
                <Legend />
                <Bar yAxisId="j" dataKey="journeesAm1" name="Journées de 11 à 12 h" stackId="j" fill={COULEUR_AM1} />
                <Bar yAxisId="j" dataKey="journeesAm2" name="Journées de plus de 12 h" stackId="j" fill={COULEUR_AM2} />
                <Line yAxisId="c" dataKey="concernes" name="Chauffeurs concernés (axe de droite)" stroke={COULEUR_CONCERNES} strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {duMois && duMois.concernes > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-medium">Chauffeurs selon leur nombre de journées longues — activité de {libelleActivite(duMois.mois, annee)}</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={tranches} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="libelle" tick={{ fontSize: 12 }} label={{ value: "journées de plus de 11 h dans le mois", position: "insideBottom", offset: -2, fontSize: 11 }} height={40} />
                <YAxis tick={{ fontSize: 12 }} width={50} allowDecimals={false} />
                <Tooltip
                  contentStyle={styleTooltip}
                  labelFormatter={(label) => `${label} journée(s) longue(s)`}
                  formatter={(value: number | string | undefined) => [`${entier(Number(value ?? 0))} chauffeurs`, ""]}
                />
                <Bar dataKey="salaries" name="Chauffeurs" fill={COULEUR_AM1} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {duMois && (
          <Tabs defaultValue="depot">
            <TabsList className="mb-4">
              <TabsTrigger value="depot">Par dépôt</TabsTrigger>
              <TabsTrigger value="fonction">Par fonction</TabsTrigger>
            </TabsList>
            <TabsContent value="depot">
              <p className="mb-2 text-xs text-muted-foreground">
                Chaque dépôt est rapporté à SES chauffeurs payés du mois, concernés ou non : à effectif égal, les dépôts se comparent directement. La moyenne rapporte tout le périmètre à ses chauffeurs ; un écart de plus de 15 % est mis en évidence.
                Dépôt lu dans le roster du mois (service) ; les dépôts de moins de 3 chauffeurs concernés sont regroupés, pour qu&apos;aucune prime individuelle ne se lise. Un chauffeur à temps partiel compte pour un.
              </p>
              <GraphiqueParChauffeur lignes={parDepot} ensemble={duMois} />
              <TableVentilation lignes={parDepot} entete="Dépôt" ensemble={duMois} />
            </TabsContent>
            <TabsContent value="fonction">
              <p className="mb-2 text-xs text-muted-foreground">Fonctions de chauffeur telles que la paie les porte ; les rares autres fonctions concernées restent dans les totaux du mois.</p>
              <TableVentilation lignes={parFonction} entete="Fonction" ensemble={duMois} />
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
