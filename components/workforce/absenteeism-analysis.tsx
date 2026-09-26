"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList } from "recharts";
import { FRENCH_MONTHS_SHORT } from "@/lib/constants";
import { Activity, Building2, ArrowDown, ArrowUp, ArrowUpDown, UserX } from "lucide-react";
import { NB_BRADFORD, SEUIL_CLASSEMENT_DEPOT_ETP, type AbsenteismeAnnee, type AbsenteismeDepot } from "@/lib/utils/wp-absenteisme";

// Trio validé (CVD ΔE ≥ 8,8 avec légende, contraste ≥ 3:1 sur fond clair)
const COULEURS = { cns: "#2563eb", mct: "#d97706", injustifiees: "#0f9f6e" };

const fmtEtp = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtPct = (n: number) => `${n.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
const fmtInt = (n: number) => n.toLocaleString("fr-FR");

type CleTri = "netEtpMoyen" | "cns" | "mct" | "injustifiees" | "global";

const COLONNES_DEPOT: { cle: CleTri; label: string; pct?: boolean }[] = [
  { cle: "netEtpMoyen", label: "ETP disponible" },
  { cle: "cns", label: "CNS", pct: true },
  { cle: "mct", label: "MCT", pct: true },
  { cle: "injustifiees", label: "Injustifiées", pct: true },
  { cle: "global", label: "Global", pct: true },
];

interface Props {
  anneeInitiale?: number | null;
  analyses: AbsenteismeAnnee[];
}

export function AbsenteeismAnalysis({ analyses, anneeInitiale }: Props) {
  const [annee, setAnnee] = useState(
    analyses.some((x) => x.annee === anneeInitiale) ? (anneeInitiale as number) : analyses[analyses.length - 1]?.annee
  );
  const [tri, setTri] = useState<{ cle: CleTri; desc: boolean }>({ cle: "global", desc: true });
  const a = analyses.find((x) => x.annee === annee) ?? analyses[analyses.length - 1];

  const depotsTries = useMemo<AbsenteismeDepot[]>(() => {
    if (!a) return [];
    const sens = tri.desc ? -1 : 1;
    return a.parDepot.slice().sort((x, y) =>
      Number(y.classable) - Number(x.classable) || sens * (x[tri.cle] - y[tri.cle]) || y.netEtpMoyen - x.netEtpMoyen
    );
  }, [a, tri]);
  const changerTri = (cle: CleTri) => setTri((t) => (t.cle === cle ? { cle, desc: !t.desc } : { cle, desc: true }));

  if (!a) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Aucune absence à analyser.
      </div>
    );
  }

  const chartData = a.parMois.map((m) => ({ month: FRENCH_MONTHS_SHORT[m.mois], CNS: m.cns, MCT: m.mct, Injustifiées: m.injustifiees, Global: m.global }));
  const classables = depotsTries.filter((d) => d.classable);
  const parValeurDesc = classables.slice().sort((x, y) => y[tri.cle] - x[tri.cle]);
  const plusForts = new Set(parValeurDesc.slice(0, 3).map((d) => d.depot));
  const plusFaibles = new Set(parValeurDesc.slice(-3).map((d) => d.depot).filter((d) => !plusForts.has(d)));
  const colonneTriee = COLONNES_DEPOT.find((c) => c.cle === tri.cle)?.label.toLowerCase();
  const nbPartis = a.bradford.filter((b) => b.parti).length;

  const tooltipStyle = { borderRadius: "8px", border: "1px solid var(--border)", backgroundColor: "var(--background)" };

  const tuiles: { label: string; taux: number; couleur?: string; detail: string }[] = [
    { label: "Absentéisme global", taux: a.taux.global, detail: `sur ${fmtEtp(a.netEtpMoyen)} ETP disponibles · ${a.moisAvecDonnees.length} mois` },
    { label: "Couverture CNS", taux: a.taux.cns, couleur: COULEURS.cns, detail: "maladie, accident, maternité…" },
    { label: "Maladies non prises en charge", taux: a.taux.mct, couleur: COULEURS.mct, detail: "heures MCT hors week-end" },
    { label: "Absences injustifiées", taux: a.taux.injustifiees, couleur: COULEURS.injustifiees, detail: "heures injustifiées" },
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
            <Activity className="h-4 w-4" />
            Absentéisme {a.annee}
          </CardTitle>
          <CardDescription>
            Heures d&apos;absence rapportées aux heures travaillables des salariés disponibles, mêmes définitions que le tableau de bord, mois par mois dans la photo du mois.
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
                <p className="text-xs text-muted-foreground">{t.detail}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Absentéisme par mois</CardTitle>
          <CardDescription>Taux mensuel empilé : CNS, MCT et injustifiées</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={{ top: 18, right: 20, bottom: 5, left: 0 }} barCategoryGap="35%">
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} width={40} unit="%" />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtPct(Number(v))} />
              <Legend />
              <Bar dataKey="CNS" stackId="s" fill={COULEURS.cns} stroke="var(--background)" strokeWidth={1} />
              <Bar dataKey="MCT" stackId="s" fill={COULEURS.mct} stroke="var(--background)" strokeWidth={1} />
              <Bar dataKey="Injustifiées" stackId="s" fill={COULEURS.injustifiees} stroke="var(--background)" strokeWidth={1} radius={[4, 4, 0, 0]}>
                {/* Total global au-dessus de la pile, en encre de texte (pas la couleur d'une série) */}
                <LabelList dataKey="Global" position="top" offset={6} formatter={(v) => fmtPct(Number(v))} className="fill-foreground" fontSize={12} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Absentéisme par dépôt
          </CardTitle>
          <CardDescription>
            Cliquer un en-tête pour trier ; les badges suivent la colonne triée ({colonneTriee}).
            Le classement ne retient que les dépôts d&apos;au moins {SEUIL_CLASSEMENT_DEPOT_ETP} ETP disponibles en moyenne.
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
                <TableHead className="text-xs text-right">Heures MCT</TableHead>
                <TableHead className="text-xs text-right">Heures inj.</TableHead>
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
                  <TableCell className="text-sm text-right">{fmtInt(d.heuresMct)}</TableCell>
                  <TableCell className="text-sm text-right">{fmtInt(d.heuresInjustifiees)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <UserX className="h-4 w-4" />
            Scores de Bradford les plus élevés
          </CardTitle>
          <CardDescription>
            Bradford = épisodes² × jours d&apos;absence sur l&apos;année (MCT, injustifiées et maladie CNS). Il pénalise les absences courtes et répétées.
            Les {NB_BRADFORD} premiers ; les salariés qui ont quitté l&apos;entreprise sont en gris clair{nbPartis > 0 ? ` (${nbPartis})` : ""}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs w-10">#</TableHead>
                <TableHead className="text-xs">Salarié</TableHead>
                <TableHead className="text-xs">Dépôt</TableHead>
                <TableHead className="text-xs text-right">Épisodes</TableHead>
                <TableHead className="text-xs text-right">Jours</TableHead>
                <TableHead className="text-xs text-right">dont CNS</TableHead>
                <TableHead className="text-xs text-right">Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {a.bradford.map((b, i) => (
                <TableRow key={b.code_salarie} className={b.parti ? "text-muted-foreground/70" : ""}>
                  <TableCell className="text-sm">{i + 1}</TableCell>
                  <TableCell className="text-sm">
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <span>{b.nom}</span>
                      <span className="text-xs text-muted-foreground/70">{b.code_salarie}</span>
                      {b.parti && <Badge variant="outline" className="text-xs font-normal text-muted-foreground/70">Parti</Badge>}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">{b.depot}</TableCell>
                  <TableCell className="text-sm text-right">{b.episodes}</TableCell>
                  <TableCell className="text-sm text-right">{fmtEtp(b.jours)}</TableCell>
                  <TableCell className="text-sm text-right">{fmtEtp(b.joursCns)}</TableCell>
                  <TableCell className="text-sm text-right font-medium">{fmtInt(b.score)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
