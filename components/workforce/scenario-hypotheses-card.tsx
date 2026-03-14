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
import { ClipboardList, ChevronRight, ChevronDown } from "lucide-react";
import { FRENCH_MONTHS_SHORT } from "@/lib/constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArrivalHypothesisItem {
  nb_personnes: number;
  taux_occupation: number;
  type_contrat: "CDI" | "CDD";
  fonction: string | null;
  centre_cout: string | null;
  vehicle_type: "BUS" | "CAM" | null;
  start_month: number;
  start_year: number;
  end_month: number | null;
  end_year: number | null;
}

export interface DepartureHypothesisItem {
  nb_personnes: number;
  taux_occupation: number;
  departure_type: string;
  fonction: string | null;
  centre_cout: string | null;
  vehicle_type: "BUS" | "CAM" | null;
  departure_month: number;
  departure_year: number;
}

export interface TempExitHypothesisItem {
  nb_personnes: number;
  taux_occupation: number;
  motif: string;
  fonction: string | null;
  centre_cout: string | null;
  vehicle_type: "BUS" | "CAM" | null;
  departure_month: number;
  departure_year: number;
  return_month: number | null;
  return_year: number | null;
}

export interface RateByMonthCC {
  mois: number;
  centre_cout: string | null;
  rate: number;
}

interface Props {
  arrivals: ArrivalHypothesisItem[];
  departures: DepartureHypothesisItem[];
  tempExits: TempExitHypothesisItem[];
  turnoverRates: RateByMonthCC[];
  absRates: RateByMonthCC[];
  turnoverSrcName: string | null;
  absSrcName: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtMonth(month: number, year: number) {
  return `${FRENCH_MONTHS_SHORT[month]} ${year}`;
}

function sumEtp(items: { nb_personnes: number; taux_occupation: number }[]) {
  return items.reduce((s, i) => s + (i.nb_personnes * i.taux_occupation) / 100, 0);
}

function fmtEtp(value: number) {
  return value % 1 === 0 ? value.toString() : value.toFixed(1);
}

function fmtRate(rate: number) {
  return `${rate.toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Collapsible section wrapper
// ---------------------------------------------------------------------------

function CollapsibleSection({
  label,
  count,
  color,
  children,
}: {
  label: string;
  count?: number;
  color: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        className="flex items-center gap-2 w-full py-2 px-1 hover:bg-muted/50 rounded-md transition-colors"
        onClick={() => setOpen(!open)}
      >
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <span className={`text-sm font-semibold ${color}`}>{label}</span>
        {count != null && (
          <Badge variant="secondary" className="text-xs ml-1">
            {count}
          </Badge>
        )}
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section tables
// ---------------------------------------------------------------------------

function ArrivalsSection({ items }: { items: ArrivalHypothesisItem[] }) {
  return (
    <div className="max-h-[400px] overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Mois</TableHead>
            <TableHead className="text-xs">Nb pers.</TableHead>
            <TableHead className="text-xs">Taux occ.</TableHead>
            <TableHead className="text-xs">Contrat</TableHead>
            <TableHead className="text-xs">Fonction</TableHead>
            <TableHead className="text-xs">CC</TableHead>
            <TableHead className="text-xs">Type véh.</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((a, i) => (
            <TableRow key={i}>
              <TableCell className="text-sm">
                {fmtMonth(a.start_month, a.start_year)}
                {a.end_month && a.end_year ? ` → ${fmtMonth(a.end_month, a.end_year)}` : ""}
              </TableCell>
              <TableCell className="text-sm">{a.nb_personnes}</TableCell>
              <TableCell className="text-sm">{a.taux_occupation}%</TableCell>
              <TableCell>
                <Badge variant="outline" className="text-xs">
                  {a.type_contrat}
                </Badge>
              </TableCell>
              <TableCell className="text-sm">{a.fonction || "—"}</TableCell>
              <TableCell className="text-sm">{a.centre_cout || "—"}</TableCell>
              <TableCell className="text-sm">{a.vehicle_type || "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function DeparturesSection({ items }: { items: DepartureHypothesisItem[] }) {
  return (
    <div className="max-h-[400px] overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Mois</TableHead>
            <TableHead className="text-xs">Nb pers.</TableHead>
            <TableHead className="text-xs">Taux occ.</TableHead>
            <TableHead className="text-xs">Type départ</TableHead>
            <TableHead className="text-xs">Fonction</TableHead>
            <TableHead className="text-xs">CC</TableHead>
            <TableHead className="text-xs">Type véh.</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((d, i) => (
            <TableRow key={i}>
              <TableCell className="text-sm">
                {fmtMonth(d.departure_month, d.departure_year)}
              </TableCell>
              <TableCell className="text-sm">{d.nb_personnes}</TableCell>
              <TableCell className="text-sm">{d.taux_occupation}%</TableCell>
              <TableCell className="text-sm">{d.departure_type}</TableCell>
              <TableCell className="text-sm">{d.fonction || "—"}</TableCell>
              <TableCell className="text-sm">{d.centre_cout || "—"}</TableCell>
              <TableCell className="text-sm">{d.vehicle_type || "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function TempExitsSection({ items }: { items: TempExitHypothesisItem[] }) {
  return (
    <div className="max-h-[400px] overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Départ</TableHead>
            <TableHead className="text-xs">Retour</TableHead>
            <TableHead className="text-xs">Nb pers.</TableHead>
            <TableHead className="text-xs">Taux occ.</TableHead>
            <TableHead className="text-xs">Motif</TableHead>
            <TableHead className="text-xs">Fonction</TableHead>
            <TableHead className="text-xs">CC</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((t, i) => (
            <TableRow key={i}>
              <TableCell className="text-sm">
                {fmtMonth(t.departure_month, t.departure_year)}
              </TableCell>
              <TableCell className="text-sm">
                {t.return_month && t.return_year
                  ? fmtMonth(t.return_month, t.return_year)
                  : "—"}
              </TableCell>
              <TableCell className="text-sm">{t.nb_personnes}</TableCell>
              <TableCell className="text-sm">{t.taux_occupation}%</TableCell>
              <TableCell className="text-sm">{t.motif}</TableCell>
              <TableCell className="text-sm">{t.fonction || "—"}</TableCell>
              <TableCell className="text-sm">{t.centre_cout || "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RatesSection({ rates, label }: { rates: RateByMonthCC[]; label: string }) {
  if (rates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        Aucun taux configuré.
      </p>
    );
  }

  // Build a pivot: rows = months, columns = cost centers
  const ccSet = new Set<string>();
  const globalByMonth = new Map<number, number>();
  const ccByMonthCc = new Map<string, number>();

  for (const r of rates) {
    if (r.centre_cout) {
      ccSet.add(r.centre_cout);
      ccByMonthCc.set(`${r.mois}:${r.centre_cout}`, r.rate);
    } else {
      globalByMonth.set(r.mois, r.rate);
    }
  }

  const costCenters = Array.from(ccSet).sort();
  const months = Array.from(new Set(rates.map((r) => r.mois))).sort((a, b) => a - b);

  return (
    <div className="max-h-[400px] overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Mois</TableHead>
            <TableHead className="text-xs">Global</TableHead>
            {costCenters.map((cc) => (
              <TableHead key={cc} className="text-xs">
                {cc}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {months.map((m) => (
            <TableRow key={m}>
              <TableCell className="text-sm font-medium">
                {FRENCH_MONTHS_SHORT[m]}
              </TableCell>
              <TableCell className="text-sm">
                {globalByMonth.has(m) ? fmtRate(globalByMonth.get(m)!) : "—"}
              </TableCell>
              {costCenters.map((cc) => {
                const key = `${m}:${cc}`;
                return (
                  <TableCell key={cc} className="text-sm">
                    {ccByMonthCc.has(key) ? fmtRate(ccByMonthCc.get(key)!) : "—"}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ScenarioHypothesesCard({
  arrivals,
  departures,
  tempExits,
  turnoverRates,
  absRates,
  turnoverSrcName,
  absSrcName,
}: Props) {
  const totalArrivals = arrivals.reduce((s, a) => s + a.nb_personnes, 0);
  const totalDepartures = departures.reduce((s, d) => s + d.nb_personnes, 0);
  const totalTempExits = tempExits.reduce((s, t) => s + t.nb_personnes, 0);
  const etpArrivals = sumEtp(arrivals);
  const etpDepartures = sumEtp(departures);
  const etpTempExits = sumEtp(tempExits);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="h-4 w-4" />
          Hypothèses scénarios appliquées
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* KPI summary */}
        <div className="flex flex-wrap gap-4">
          <div className="rounded-lg border px-4 py-2 text-center">
            <div className="text-lg font-bold text-green-700">{totalArrivals}</div>
            <div className="text-xs text-muted-foreground">
              Arrivées · {fmtEtp(etpArrivals)} ETP
            </div>
          </div>
          <div className="rounded-lg border px-4 py-2 text-center">
            <div className="text-lg font-bold text-red-700">{totalDepartures}</div>
            <div className="text-xs text-muted-foreground">
              Départs · {fmtEtp(etpDepartures)} ETP
            </div>
          </div>
          <div className="rounded-lg border px-4 py-2 text-center">
            <div className="text-lg font-bold text-amber-700">{totalTempExits}</div>
            <div className="text-xs text-muted-foreground">
              Sorties temp. · {fmtEtp(etpTempExits)} ETP
            </div>
          </div>
        </div>

        {/* Collapsible detail sections */}
        <div className="space-y-1">
          <CollapsibleSection
            label={`Arrivées (${totalArrivals})`}
            count={totalArrivals}
            color="text-green-700"
          >
            <ArrivalsSection items={arrivals} />
          </CollapsibleSection>

          <CollapsibleSection
            label={`Départs (${totalDepartures})`}
            count={totalDepartures}
            color="text-red-700"
          >
            <DeparturesSection items={departures} />
          </CollapsibleSection>

          <CollapsibleSection
            label={`Sorties temporaires (${totalTempExits})`}
            count={totalTempExits}
            color="text-amber-700"
          >
            <TempExitsSection items={tempExits} />
          </CollapsibleSection>

          <CollapsibleSection
            label={`Taux de turnover${turnoverSrcName ? ` (source : ${turnoverSrcName})` : ""}`}
            color="text-blue-700"
          >
            <RatesSection rates={turnoverRates} label="turnover" />
          </CollapsibleSection>

          <CollapsibleSection
            label={`Taux d'absentéisme${absSrcName ? ` (source : ${absSrcName})` : ""}`}
            color="text-violet-700"
          >
            <RatesSection rates={absRates} label="absentéisme" />
          </CollapsibleSection>
        </div>
      </CardContent>
    </Card>
  );
}
