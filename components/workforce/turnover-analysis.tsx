"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList } from "recharts";
import { FRENCH_MONTHS_SHORT } from "@/lib/constants";
import { Repeat, Building2, ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { CATEGORIE_LABELS, SEUIL_CLASSEMENT_DEPOT_ETP, type TurnoverAnnee, type TurnoverDepot } from "@/lib/utils/wp-turnover";

type CleTri = "effectifMoyenEtp" | "sortiesEtp" | "volontaireEtp" | "involontaireEtp" | "tauxVolontaire" | "tauxInvolontaire" | "taux";

const COLONNES_DEPOT: { cle: CleTri; label: string; pct?: boolean }[] = [
  { cle: "effectifMoyenEtp", label: "Effectif moyen" },
  { cle: "sortiesEtp", label: "Sorties" },
  { cle: "volontaireEtp", label: "Volont." },
  { cle: "involontaireEtp", label: "Involont." },
  { cle: "tauxVolontaire", label: "Taux volont.", pct: true },
  { cle: "tauxInvolontaire", label: "Taux involont.", pct: true },
  { cle: "taux", label: "Taux", pct: true },
];

// Paire validée (CVD ΔE 32, contraste ≥ 3:1 sur fond clair)
const COULEURS = {
  volontaire: "#2563eb",
  involontaire: "#d97706",
  autre: "#6b7280",
};

const arrondi1 = (n: number) => Math.round(n * 10) / 10;
const fmtEtp = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtPct = (n: number) => `${n.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;

interface Props {
  anneeInitiale?: number | null;
  analyses: TurnoverAnnee[];
}

export function TurnoverAnalysis({ analyses, anneeInitiale }: Props) {
  const [annee, setAnnee] = useState(
    analyses.some((x) => x.annee === anneeInitiale) ? (anneeInitiale as number) : analyses[analyses.length - 1]?.annee
  );
  const [tri, setTri] = useState<{ cle: CleTri; desc: boolean }>({ cle: "taux", desc: true });
  const a = analyses.find((x) => x.annee === annee) ?? analyses[analyses.length - 1];

  // Classables toujours devant ; badges « Plus fort / Plus faible » sur la colonne triée
  const depotsTries = useMemo<TurnoverDepot[]>(() => {
    if (!a) return [];
    const sens = tri.desc ? -1 : 1;
    return a.parDepot.slice().sort((x, y) =>
      Number(y.classable) - Number(x.classable) || sens * (x[tri.cle] - y[tri.cle]) || y.effectifMoyenEtp - x.effectifMoyenEtp
    );
  }, [a, tri]);
  const changerTri = (cle: CleTri) =>
    setTri((t) => (t.cle === cle ? { cle, desc: !t.desc } : { cle, desc: true }));

  if (!a) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Aucune sortie à analyser.
      </div>
    );
  }

  const chartData = a.parMois.map((m) => ({
    month: FRENCH_MONTHS_SHORT[m.mois],
    Volontaire: m.volontaire,
    Involontaire: m.involontaire,
    Autre: m.autre,
    Total: arrondi1(m.volontaire + m.involontaire + m.autre),
    taux: m.taux,
    effectifEtp: m.effectifEtp,
    couvert: m.couvert,
  }));
  const fmtPct2 = (n: number) => `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
  const aDesMoisReconduits = a.parMois.some((m) => !m.couvert && m.volontaire + m.involontaire + m.autre > 0);
  // Axe à deux lignes : le mois, et dessous son taux de turnover mensuel.
  // Un mois sans photo (effectif reconduit) s'écrit en gris italique.
  const tickMoisEtTaux = ({ x, y, payload, index }: { x?: number | string; y?: number | string; payload?: { value: string }; index?: number }) => {
    const d = chartData[index ?? 0];
    return (
      <g transform={`translate(${x},${y})`}>
        <text dy={12} textAnchor="middle" fontSize={12} className="fill-muted-foreground">{payload?.value}</text>
        {d && d.effectifEtp > 0 && (
          <text dy={30} textAnchor="middle" fontSize={12} fontWeight={600} fontStyle={d.couvert ? "normal" : "italic"} className={d.couvert ? "fill-foreground" : "fill-muted-foreground"}>
            {fmtPct2(d.taux)}
          </text>
        )}
      </g>
    );
  };
  const aDesAutres = a.categories.autre.nb > 0;
  const nbMoisCouverts = a.moisCouverts.length;
  const annualise = (taux: number) => (nbMoisCouverts > 0 && nbMoisCouverts < 12 ? (taux * 12) / nbMoisCouverts : taux);

  const classables = depotsTries.filter((d) => d.classable);
  const parValeurDesc = classables.slice().sort((x, y) => y[tri.cle] - x[tri.cle]);
  const plusForts = new Set(parValeurDesc.slice(0, 3).map((d) => d.depot));
  const plusFaibles = new Set(parValeurDesc.slice(-3).map((d) => d.depot).filter((d) => !plusForts.has(d)));
  const colonneTriee = COLONNES_DEPOT.find((c) => c.cle === tri.cle)?.label.toLowerCase();

  const tooltipStyle = {
    borderRadius: "8px",
    border: "1px solid var(--border)",
    backgroundColor: "var(--background)",
  };

  const tuiles: { label: string; taux: number; nb: number; etp: number; couleur?: string }[] = [
    { label: "Turnover hors fins de CDD", taux: a.tauxTotal, nb: a.categories.volontaire.nb + a.categories.involontaire.nb + a.categories.autre.nb, etp: a.categories.volontaire.etp + a.categories.involontaire.etp + a.categories.autre.etp },
    { label: "Volontaire", taux: a.categories.volontaire.taux, nb: a.categories.volontaire.nb, etp: a.categories.volontaire.etp, couleur: COULEURS.volontaire },
    { label: "Involontaire", taux: a.categories.involontaire.taux, nb: a.categories.involontaire.nb, etp: a.categories.involontaire.etp, couleur: COULEURS.involontaire },
  ];

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
            <Repeat className="h-4 w-4" />
            Turnover {a.annee}
          </CardTitle>
          <CardDescription>
            Sorties définitives en ETP rapportées à l&apos;effectif moyen ({fmtEtp(a.effectifMoyenEtp)} ETP
            sur {nbMoisCouverts} mois). Les fins de mission des CDD sont exclues du turnover.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            {tuiles.map((t) => (
              <div key={t.label}>
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  {t.couleur && <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: t.couleur }} />}
                  {t.label}
                </p>
                <p className="text-xl font-bold">{fmtPct(t.taux)}</p>
                <p className="text-xs text-muted-foreground">
                  {t.nb} sortie{t.nb > 1 ? "s" : ""} · {fmtEtp(t.etp)} ETP
                  {nbMoisCouverts < 12 && ` · ${fmtPct(annualise(t.taux))} annualisé`}
                </p>
              </div>
            ))}
            <div>
              <p className="text-xs text-muted-foreground">Fins de mission exclues</p>
              <p className="text-xl font-bold">{a.categories.fin_de_mission.nb}</p>
              <p className="text-xs text-muted-foreground">
                {fmtEtp(a.categories.fin_de_mission.etp)} ETP · {fmtPct(a.categories.fin_de_mission.taux)} de l&apos;effectif
              </p>
            </div>
          </div>
          {aDesAutres && (
            <p className="mt-4 text-xs text-amber-600">
              {a.categories.autre.nb} sortie{a.categories.autre.nb > 1 ? "s" : ""} au motif non classé ({fmtEtp(a.categories.autre.etp)} ETP), comptée{a.categories.autre.nb > 1 ? "s" : ""} dans le total mais ni volontaire ni involontaire.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sorties par mois</CardTitle>
          <CardDescription>
            ETP sortis chaque mois, hors fins de mission. Sous chaque mois, le taux de turnover mensuel : sorties du mois / effectif en fin de mois.
            {aDesMoisReconduits && " En gris italique : mois sans roster, effectif reconduit de la dernière photo (sorties déjà datées retirées)."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={{ top: 18, right: 20, bottom: 5, left: 0 }} barCategoryGap="35%">
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" />
              <XAxis dataKey="month" tick={tickMoisEtTaux} height={48} interval={0} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} width={36} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v) => `${fmtEtp(Number(v))} ETP`}
                labelFormatter={(label) => {
                  const d = chartData.find((c) => c.month === label);
                  return d && d.effectifEtp > 0
                    ? `${label} — turnover ${fmtPct2(d.taux)} (${fmtEtp(d.Total)} / ${fmtEtp(d.effectifEtp)} ETP${d.couvert ? "" : ", effectif reconduit"})`
                    : String(label);
                }}
              />
              <Legend />
              <Bar dataKey="Volontaire" stackId="s" fill={COULEURS.volontaire} stroke="var(--background)" strokeWidth={1} />
              <Bar dataKey="Involontaire" stackId="s" fill={COULEURS.involontaire} stroke="var(--background)" strokeWidth={1} radius={aDesAutres ? 0 : [4, 4, 0, 0]}>
                {!aDesAutres && <LabelList dataKey="Total" position="top" offset={6} formatter={(v) => (Number(v) > 0 ? fmtEtp(Number(v)) : "")} className="fill-foreground" fontSize={12} />}
              </Bar>
              {aDesAutres && (
                <Bar dataKey="Autre" stackId="s" fill={COULEURS.autre} stroke="var(--background)" strokeWidth={1} radius={[4, 4, 0, 0]}>
                  <LabelList dataKey="Total" position="top" offset={6} formatter={(v) => (Number(v) > 0 ? fmtEtp(Number(v)) : "")} className="fill-foreground" fontSize={12} />
                </Bar>
              )}
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Motifs de sortie</CardTitle>
            <CardDescription>Part en ETP de toutes les sorties, fins de mission comprises</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Motif</TableHead>
                  <TableHead className="text-xs">Catégorie</TableHead>
                  <TableHead className="text-xs text-right">Nombre</TableHead>
                  <TableHead className="text-xs text-right">ETP</TableHead>
                  <TableHead className="text-xs text-right">Part</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {a.parMotif.map((m) => (
                  <TableRow key={m.motif}>
                    <TableCell className="text-sm">{m.motif}</TableCell>
                    <TableCell className="text-sm">
                      <span className="inline-flex items-center gap-1.5">
                        {(m.categorie === "volontaire" || m.categorie === "involontaire" || m.categorie === "autre") && (
                          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: COULEURS[m.categorie] }} />
                        )}
                        {CATEGORIE_LABELS[m.categorie]}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-right">{m.nb}</TableCell>
                    <TableCell className="text-sm text-right font-medium">{fmtEtp(m.etp)}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline" className="text-xs">{fmtPct(m.part)}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Turnover par dépôt
            </CardTitle>
            <CardDescription>
              Hors fins de mission. Cliquer un en-tête pour trier ; les badges suivent la colonne triée ({colonneTriee}).
              Le classement ne retient que les dépôts d&apos;au moins {SEUIL_CLASSEMENT_DEPOT_ETP} ETP en moyenne.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Dépôt</TableHead>
                  {COLONNES_DEPOT.map((c) => {
                    const active = tri.cle === c.cle;
                    const Icone = active ? (tri.desc ? ArrowDown : ArrowUp) : ArrowUpDown;
                    return (
                      <TableHead key={c.cle} className="text-xs text-right">
                        <button
                          type="button"
                          onClick={() => changerTri(c.cle)}
                          aria-sort={active ? (tri.desc ? "descending" : "ascending") : "none"}
                          className={`inline-flex items-center gap-1 hover:text-foreground ${active ? "text-foreground font-semibold" : ""}`}
                        >
                          {c.label}
                          <Icone className={`h-3 w-3 ${active ? "" : "opacity-40"}`} />
                        </button>
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {depotsTries.map((d) => (
                  <TableRow key={d.depot} className={d.classable ? "" : "text-muted-foreground"}>
                    <TableCell className="text-sm">
                      <span className="inline-flex flex-wrap items-center gap-2">
                        {d.depot}
                        {plusForts.has(d.depot) && <Badge className="text-xs bg-amber-100 text-amber-800 hover:bg-amber-100">Plus fort</Badge>}
                        {plusFaibles.has(d.depot) && <Badge className="text-xs bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Plus faible</Badge>}
                      </span>
                    </TableCell>
                    {COLONNES_DEPOT.map((c) => (
                      <TableCell key={c.cle} className={`text-sm text-right ${tri.cle === c.cle ? "font-medium" : ""}`}>
                        {c.pct ? fmtPct(d[c.cle]) : fmtEtp(d[c.cle])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
