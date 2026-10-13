/**
 * Boîte à outils de l'analyste IA : fonctions PURES sur `DonneesAnalyse`, qui
 * ne renvoient que des agrégats (en anglais, prêts à citer). L'IA ne calcule
 * rien : moyennes, écarts à la moyenne et parts sont calculés ici, arrondis,
 * pour qu'elle n'ait qu'à reprendre des valeurs — que `verification.ts`
 * retrouve ensuite dans les sorties.
 *
 * Anonymat : groupes de moins de 3 fusionnés (SEUIL_ANONYMAT), dépôts trop
 * petits pour un taux d'absence ou de départ écartés (SEUIL_CLASSEMENT_DEPOT_ETP),
 * jamais de code salarié ni de nom — le classement Bradford, nominatif, n'est
 * pas repris.
 */

import { PERIODS } from "@/lib/constants";
import { SEUIL_ANONYMAT, regrouperPetitsGroupes } from "@/lib/utils/wp-anonymisation";
import { agregerAmplitudes, estChauffeur, tauxDuMois, ventilerAmplitudes } from "@/lib/utils/wp-amplitudes";
import { joursParSalarie, lignesDeLaPeriode, moisFinPeriode, sixiemesJoursParPeriode, ventilerSixiemesJours } from "@/lib/utils/wp-sixiemes-jours";
import { analyserAbsenteisme } from "@/lib/utils/wp-absenteisme";
import { analyserTurnover } from "@/lib/utils/wp-turnover";
import { periodesDesPhotos } from "@/lib/utils/roster-photos";
import { concentrationParGroupe, mesurerConcentration, recurrenceDuTop, type Concentration, type ValeurChauffeur } from "./concentration";
import type { DonneesAnalyse } from "./donnees";

const MOIS_EN = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const r2 = (x: number) => Math.round(x * 100) / 100;
const r1 = (x: number) => Math.round(x * 10) / 10;
const pct = (part: number, total: number) => (total > 0 ? r1((part / total) * 100) : null);
const ecart = (v: number | null, moyenne: number | null) => (v == null || !moyenne ? null : r1(((v - moyenne) / moyenne) * 100));
const parChauffeur = (n: number, chauffeurs: number) => (chauffeurs > 0 ? r2(n / chauffeurs) : null);
const libelleMois = (mois: number, annee: number) => `${MOIS_EN[mois]} ${annee}`;
const nomDepot = (d: string) => d.replace(/^Depots? - /i, "");
const periodeEn = (annee: number, numero: number) => {
  const def = PERIODS.find((x) => x.number === numero);
  return def ? `P${numero} ${annee} (${MOIS_EN[def.startMonth]}–${MOIS_EN[def.endMonth]})` : `P${numero} ${annee}`;
};
/** Le mois de paie qui porte l'activité d'un mois (amplitudes payées M+1). */
const moisDePaie = (mois: number, annee: number) => (mois === 12 ? { mois: 1, annee: annee + 1 } : { mois: mois + 1, annee });
const moisDActivite = (mois: number, annee: number) => (mois === 1 ? { mois: 12, annee: annee - 1 } : { mois: mois - 1, annee });

function concentrationLisible(c: Concentration | null) {
  if (!c) return null;
  return {
    drivers: c.effectif,
    total: r2(c.total),
    mean: r2(c.moyenne),
    drivers_above_zero: c.concernes,
    median: c.mediane == null ? null : r2(c.mediane),
    p90: c.p90 == null ? null : r2(c.p90),
    share_of_total_top10_pct: c.partTop10 == null ? null : r1(c.partTop10 * 100),
    share_of_total_top20_pct: c.partTop20 == null ? null : r1(c.partTop20 * 100),
    gini: r2(c.gini),
    decile_means: c.moyennesDeciles?.map(r2) ?? null,
    drivers_at_or_above_threshold: c.auDelaDuSeuil,
  };
}

// ---------------------------------------------------------------- couverture

export function couvertureDonnees(d: DonneesAnalyse, maintenant = new Date()) {
  const moisPaie = [...new Set(d.paie.map((l) => `${l.annee}-${String(l.mois).padStart(2, "0")}`))].sort();
  const moisHeures = [...new Set(d.heures.map((h) => `${h.annee}-${String(h.mois).padStart(2, "0")}`))].sort();
  const periodes = sixiemesJoursParPeriode(d.paie).map((p) => periodeEn(p.annee, p.numero));
  const photos = periodesDesPhotos(d.photos).sort((a, b) => a.annee - b.annee || a.mois - b.mois);
  const anneesAbsence = [...new Set(d.absencesCns.map((a) => Number(a.annee)))].sort();
  return {
    today: maintenant.toISOString().slice(0, 10),
    payroll_months_available: moisPaie,
    long_days_activity_months: moisPaie.map((k) => {
      const [a, m] = k.split("-").map(Number);
      const act = moisDActivite(m, a);
      return `${act.annee}-${String(act.mois).padStart(2, "0")}`;
    }),
    sixth_day_reference_periods: periodes,
    hours_months_available: moisHeures.length ? { first: moisHeures[0], last: moisHeures[moisHeures.length - 1], count: moisHeures.length } : null,
    roster_snapshots: photos.length ? { first: libelleMois(photos[0].mois, photos[0].annee), last: libelleMois(photos.at(-1)!.mois, photos.at(-1)!.annee), count: photos.length } : null,
    absence_years: anneesAbsence,
    known_limits: [
      "Long days are inferred from payroll premiums AM1 (11 to 12 h) and AM2 (over 12 h), paid per day, one month after the activity; no actual shift start/end times exist in the data.",
      "AM1 and AM2 tiers are exclusive: a day over 12 h only counts in AM2.",
      "Extra working days (6th days) are paid at 80 EUR per day after each 4-month reference period (Jan-Apr, May-Aug, Sep-Dec).",
      "Depot is read from the HR roster snapshot of the month; drivers missing from the snapshot are grouped as 'not in roster'.",
      "Part-time drivers count as one driver in per-driver ratios.",
      "Any group of fewer than 3 people is merged into 'Others'; quantiles and top shares are withheld for small groups to protect individuals.",
    ],
  };
}

// ---------------------------------------------------------------- amplitudes

function lignesDuMoisDePaie(d: DonneesAnalyse, mois: number, annee: number) {
  return d.paie.filter((l) => l.mois === mois && l.annee === annee);
}

export function journeesLonguesParDepot(d: DonneesAnalyse, p: { activity_year: number; activity_month: number }) {
  const paie = moisDePaie(p.activity_month, p.activity_year);
  const lignes = lignesDuMoisDePaie(d, paie.mois, paie.annee);
  if (lignes.length === 0) return { error: `No payroll imported for ${libelleMois(paie.mois, paie.annee)} (which pays ${libelleMois(p.activity_month, p.activity_year)} activity).` };
  const taux = tauxDuMois(lignes);
  const ensemble = agregerAmplitudes(lignes, taux);
  const moyenne = parChauffeur(ensemble.journeesAm1 + ensemble.journeesAm2, ensemble.chauffeurs);
  const depots = ventilerAmplitudes(lignes, taux, (l) => d.depotDe(l.code_salarie, p.activity_month, p.activity_year), "Not in roster", "Others")
    .map((g) => {
      const parCh = parChauffeur(g.journeesAm1 + g.journeesAm2, g.chauffeurs);
      return {
        depot: nomDepot(g.cle),
        drivers_paid: g.chauffeurs,
        drivers_with_long_days: g.concernes,
        share_with_long_days_pct: pct(g.concernes, g.chauffeurs),
        days_11_to_12h_per_driver: parChauffeur(g.journeesAm1, g.chauffeurs),
        days_over_12h_per_driver: parChauffeur(g.journeesAm2, g.chauffeurs),
        long_days_per_driver: parCh,
        deviation_from_average_pct: ecart(parCh, moyenne),
      };
    })
    .sort((a, b) => (b.long_days_per_driver ?? -1) - (a.long_days_per_driver ?? -1));
  return {
    activity_month: libelleMois(p.activity_month, p.activity_year),
    paid_in: libelleMois(paie.mois, paie.annee),
    premium_per_day_eur: { days_11_to_12h: taux.am1, days_over_12h: taux.am2 },
    overall: {
      drivers_paid: ensemble.chauffeurs,
      drivers_with_long_days: ensemble.concernes,
      share_with_long_days_pct: pct(ensemble.concernes, ensemble.chauffeurs),
      drivers_with_days_over_12h: ensemble.concernesAm2,
      days_11_to_12h: ensemble.journeesAm1,
      days_over_12h: ensemble.journeesAm2,
      long_days_total: ensemble.journeesAm1 + ensemble.journeesAm2,
      long_days_per_driver: moyenne,
      share_of_long_days_over_12h_pct: pct(ensemble.journeesAm2, ensemble.journeesAm1 + ensemble.journeesAm2),
    },
    by_depot: depots,
  };
}

export function tendanceJourneesLongues(d: DonneesAnalyse) {
  const moisPaie = [...new Set(d.paie.map((l) => `${l.annee}-${l.mois}`))].map((k) => k.split("-").map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return {
    by_activity_month: moisPaie.map(([annee, mois]) => {
      const lignes = lignesDuMoisDePaie(d, mois, annee);
      const a = agregerAmplitudes(lignes, tauxDuMois(lignes));
      const act = moisDActivite(mois, annee);
      return {
        activity_month: libelleMois(act.mois, act.annee),
        drivers_paid: a.chauffeurs,
        drivers_with_long_days: a.concernes,
        days_11_to_12h: a.journeesAm1,
        days_over_12h: a.journeesAm2,
        long_days_per_driver: parChauffeur(a.journeesAm1 + a.journeesAm2, a.chauffeurs),
      };
    }),
  };
}

// ---------------------------------------------------------------- 6e jours

function periodeDe(d: DonneesAnalyse, annee: number, numero: number) {
  return sixiemesJoursParPeriode(d.paie).find((p) => p.annee === annee && p.numero === numero) ?? null;
}

export function sixiemesJoursParDepot(d: DonneesAnalyse, p: { year: number; period: number }) {
  const sel = periodeDe(d, p.year, p.period);
  if (!sel) return { error: `No extra-day payments found for reference period P${p.period} ${p.year}.` };
  const lignes = lignesDeLaPeriode(d.paie, sel);
  const principal = { mois: sel.moisPaie, annee: sel.anneePaie };
  const fin = moisFinPeriode(sel);
  const moyenne = parChauffeur(sel.jours, sel.chauffeurs);
  const depots = ventilerSixiemesJours(lignes, principal, (l) => d.depotDe(l.code_salarie, fin, sel.annee), "Not in roster", "Others")
    .map((g) => {
      const parCh = parChauffeur(g.jours, g.chauffeurs);
      return {
        depot: nomDepot(g.cle),
        drivers_paid: g.chauffeurs,
        drivers_with_extra_days: g.concernes,
        share_with_extra_days_pct: pct(g.concernes, g.chauffeurs),
        extra_days: g.jours,
        extra_days_per_driver: parCh,
        deviation_from_average_pct: ecart(parCh, moyenne),
      };
    })
    .sort((a, b) => (b.extra_days_per_driver ?? -1) - (a.extra_days_per_driver ?? -1));
  return {
    reference_period: periodeEn(sel.annee, sel.numero),
    paid_in: libelleMois(sel.moisPaie, sel.anneePaie),
    eur_per_day: 80,
    overall: {
      drivers_paid: sel.chauffeurs,
      drivers_with_extra_days: sel.concernes,
      share_with_extra_days_pct: pct(sel.concernes, sel.chauffeurs),
      extra_days: sel.jours,
      extra_days_per_driver: moyenne,
    },
    by_depot: depots,
  };
}

export function tendanceSixiemesJours(d: DonneesAnalyse) {
  return {
    by_reference_period: sixiemesJoursParPeriode(d.paie).map((p) => ({
      period: `P${p.numero} ${p.annee}`,
      paid_in: libelleMois(p.moisPaie, p.anneePaie),
      drivers_paid: p.chauffeurs,
      drivers_with_extra_days: p.concernes,
      extra_days: p.jours,
      extra_days_per_driver: parChauffeur(p.jours, p.chauffeurs),
    })),
  };
}

// ---------------------------------------------------------------- heures

function valeursHeures(d: DonneesAnalyse, mois: number, annee: number): ValeurChauffeur[] {
  const parCode = new Map<string, number>();
  for (const h of d.heures) {
    if (h.mois !== mois || h.annee !== annee || !h.code_salarie) continue;
    parCode.set(h.code_salarie, (parCode.get(h.code_salarie) ?? 0) + Math.max(0, h.positive_hours));
  }
  return [...parCode].map(([code_salarie, valeur]) => ({ code_salarie, valeur }));
}

export function heuresParDepot(d: DonneesAnalyse, p: { year: number; month: number }) {
  const lignes = d.heures.filter((h) => h.mois === p.month && h.annee === p.year && h.code_salarie);
  if (lignes.length === 0) return { error: `No driver hours imported for ${libelleMois(p.month, p.year)}.` };
  type Agregat = { cle: string; drivers: Set<string>; positive: number; overtime: number; missing: number };
  const groupes = new Map<string, Agregat>();
  for (const h of lignes) {
    const cle = d.depotDe(h.code_salarie, p.month, p.year) || "Not in roster";
    const g = groupes.get(cle) ?? { cle, drivers: new Set<string>(), positive: 0, overtime: 0, missing: 0 };
    g.drivers.add(h.code_salarie);
    g.positive += Math.max(0, h.positive_hours);
    g.overtime += h.overtime_pay;
    g.missing += Math.abs(h.missing_hours);
    groupes.set(cle, g);
  }
  const fusion = regrouperPetitsGroupes([...groupes.values()], (g) => g.drivers.size, (petits) => ({
    cle: `Others (${petits.length})`,
    drivers: new Set(petits.flatMap((g) => [...g.drivers])),
    positive: petits.reduce((s, g) => s + g.positive, 0),
    overtime: petits.reduce((s, g) => s + g.overtime, 0),
    missing: petits.reduce((s, g) => s + g.missing, 0),
  }));
  const total = [...groupes.values()].reduce((a, g) => ({ n: a.n + g.drivers.size, positive: a.positive + g.positive, overtime: a.overtime + g.overtime, missing: a.missing + g.missing }), { n: 0, positive: 0, overtime: 0, missing: 0 });
  const moyenne = parChauffeur(total.positive, total.n);
  return {
    month: libelleMois(p.month, p.year),
    note: "Hours file of the drivers' hours tracking: positive_hours = hours above the contractual schedule in the month; overtime_paid = hours paid as overtime; missing = hours below schedule.",
    overall: {
      drivers: total.n,
      positive_hours_per_driver: moyenne,
      overtime_paid_hours_per_driver: parChauffeur(total.overtime, total.n),
      missing_hours_per_driver: parChauffeur(total.missing, total.n),
    },
    by_depot: fusion
      .map((g) => {
        const parCh = parChauffeur(g.positive, g.drivers.size);
        return {
          depot: nomDepot(g.cle),
          drivers: g.drivers.size,
          positive_hours_per_driver: parCh,
          overtime_paid_hours_per_driver: parChauffeur(g.overtime, g.drivers.size),
          missing_hours_per_driver: parChauffeur(g.missing, g.drivers.size),
          deviation_from_average_pct: ecart(parCh, moyenne),
        };
      })
      .sort((a, b) => (b.positive_hours_per_driver ?? -1) - (a.positive_hours_per_driver ?? -1)),
  };
}

// ---------------------------------------------------------------- concentration

type Indicateur = "long_days" | "extra_days" | "positive_hours";

/** Valeur de chaque chauffeur (zéros compris) et le dépôt à retenir. */
function valeursIndicateur(d: DonneesAnalyse, indicateur: Indicateur, annee: number, moisOuPeriode: number): { valeurs: ValeurChauffeur[]; depot: (code: string) => string | null; libelle: string } | { error: string } {
  if (indicateur === "long_days") {
    const paie = moisDePaie(moisOuPeriode, annee);
    const lignes = lignesDuMoisDePaie(d, paie.mois, paie.annee);
    if (lignes.length === 0) return { error: `No payroll for ${libelleMois(paie.mois, paie.annee)}.` };
    const taux = tauxDuMois(lignes);
    const parCode = new Map<string, { a1: number; a2: number; ch: boolean }>();
    for (const l of lignes) {
      const s = parCode.get(l.code_salarie) ?? { a1: 0, a2: 0, ch: false };
      s.a1 += l.nat_am1; s.a2 += l.nat_am2; s.ch ||= estChauffeur(l.fonction);
      parCode.set(l.code_salarie, s);
    }
    const jours = (m: number, t: number | null) => (t && m > 0 ? Math.round(m / t) : 0);
    return {
      valeurs: [...parCode].filter(([, s]) => s.ch).map(([code_salarie, s]) => ({ code_salarie, valeur: jours(s.a1, taux.am1) + jours(s.a2, taux.am2) })),
      depot: (code) => d.depotDe(code, moisOuPeriode, annee),
      libelle: `long days, activity of ${libelleMois(moisOuPeriode, annee)}`,
    };
  }
  if (indicateur === "extra_days") {
    const sel = periodeDe(d, annee, moisOuPeriode);
    if (!sel) return { error: `No extra-day payments for P${moisOuPeriode} ${annee}.` };
    const lignes = lignesDeLaPeriode(d.paie, sel);
    const jours = joursParSalarie(lignes);
    const chauffeurs = new Set(lignes.filter((l) => Number(l.mois) === sel.moisPaie && Number(l.annee) === sel.anneePaie && estChauffeur(l.fonction)).map((l) => l.code_salarie));
    const fin = moisFinPeriode(sel);
    return {
      valeurs: [...chauffeurs].map((code_salarie) => ({ code_salarie, valeur: jours.get(code_salarie)?.jours ?? 0 })),
      depot: (code) => d.depotDe(code, fin, annee),
      libelle: `extra working days, P${moisOuPeriode} ${annee}`,
    };
  }
  const valeurs = valeursHeures(d, moisOuPeriode, annee);
  if (valeurs.length === 0) return { error: `No driver hours for ${libelleMois(moisOuPeriode, annee)}.` };
  return { valeurs, depot: (code) => d.depotDe(code, moisOuPeriode, annee), libelle: `positive hours, ${libelleMois(moisOuPeriode, annee)}` };
}

export function concentrationCharge(d: DonneesAnalyse, p: { indicator: Indicateur; year: number; month_or_period: number; threshold?: number; by_depot?: boolean }) {
  const courant = valeursIndicateur(d, p.indicator, p.year, p.month_or_period);
  if ("error" in courant) return courant;
  // Période précédente : mois précédent, ou période de référence précédente
  const prec = p.indicator === "extra_days"
    ? (p.month_or_period === 1 ? { annee: p.year - 1, n: 3 } : { annee: p.year, n: p.month_or_period - 1 })
    : (p.month_or_period === 1 ? { annee: p.year - 1, n: 12 } : { annee: p.year, n: p.month_or_period - 1 });
  const precedent = valeursIndicateur(d, p.indicator, prec.annee, prec.n);
  const recurrence = "error" in precedent ? null : recurrenceDuTop(precedent.valeurs, courant.valeurs);
  return {
    indicator: courant.libelle,
    overall: concentrationLisible(mesurerConcentration(courant.valeurs.map((v) => v.valeur), p.threshold)),
    top10_recurrence_vs_previous: recurrence && {
      previous: "error" in precedent ? null : precedent.libelle,
      top_size: recurrence.tailleTop,
      already_in_previous_top: recurrence.dejaDansLeTop,
      recurrence_rate_pct: r1(recurrence.taux * 100),
      random_expectation_pct: 10,
    },
    by_depot: p.by_depot === false ? undefined : concentrationParGroupe(courant.valeurs, courant.depot, "Not in roster", "Others", p.threshold)
      .map((g) => ({ depot: nomDepot(g.cle), ...concentrationLisible(g) })),
    privacy: `Groups under ${SEUIL_ANONYMAT} drivers are merged; median/p90 need 10 drivers, top-20% share 15, top-10% share and deciles 30.`,
  };
}

// ---------------------------------------------------------------- absentéisme & départs

const moisCouverts = (annee: number, maintenant: Date) => {
  const dernier = annee < maintenant.getFullYear() ? 12 : annee === maintenant.getFullYear() ? maintenant.getMonth() + 1 : 0;
  return Array.from({ length: dernier }, (_, i) => i + 1);
};

export function absenteismeParDepot(d: DonneesAnalyse, p: { year: number }, maintenant = new Date()) {
  const a = analyserAbsenteisme(p.year, moisCouverts(p.year, maintenant), d.photos, d.absencesCns, d.absencesMct, d.absencesInjustifiees);
  if (a.moisAvecDonnees.length === 0) return { error: `No absence data for ${p.year}.` };
  return {
    year: p.year,
    months_with_data: a.moisAvecDonnees.map((m) => MOIS_EN[m]),
    definition: "Rates in % of available FTE time: sick leave paid by CNS, short sick leave paid by the employer (MCT), unjustified absences, and their total.",
    overall: { fte_average: r1(a.netEtpMoyen), sick_cns_pct: a.taux.cns, short_sick_mct_pct: a.taux.mct, unjustified_pct: a.taux.injustifiees, total_pct: a.taux.global },
    by_depot: a.parDepot
      .filter((x) => x.classable)
      .map((x) => ({ depot: nomDepot(x.depot), fte_average: r1(x.netEtpMoyen), sick_cns_pct: x.cns, short_sick_mct_pct: x.mct, unjustified_pct: x.injustifiees, total_pct: x.global, deviation_from_average_pct: ecart(x.global, a.taux.global) })),
    excluded: "Depots under 10 FTE are not ranked (rates would describe individuals).",
  };
}

export function departsParDepot(d: DonneesAnalyse, p: { year: number }, maintenant = new Date()) {
  const t = analyserTurnover(p.year, moisCouverts(p.year, maintenant), d.photos, d.mouvements);
  if (t.moisCouverts.length === 0) return { error: `No turnover data for ${p.year}.` };
  return {
    year: p.year,
    definition: "Exits excluding end of temporary assignments, in % of average FTE headcount; voluntary = resignations and similar, involuntary = dismissals and similar.",
    overall: { fte_average: r1(t.effectifMoyenEtp), turnover_pct: t.tauxTotal, voluntary_pct: t.categories.volontaire.taux, involuntary_pct: t.categories.involontaire.taux },
    by_depot: t.parDepot
      .filter((x) => x.classable)
      .map((x) => ({ depot: nomDepot(x.depot), fte_average: r1(x.effectifMoyenEtp), turnover_pct: x.taux, voluntary_pct: x.tauxVolontaire, involuntary_pct: x.tauxInvolontaire, deviation_from_average_pct: ecart(x.taux, t.tauxTotal) })),
    excluded: "Depots under 10 FTE are not ranked.",
  };
}

