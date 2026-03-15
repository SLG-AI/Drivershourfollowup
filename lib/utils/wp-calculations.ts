import { FRENCH_MONTHS_SHORT } from "@/lib/constants";

// ============================================================
// Luxembourg working days calculation
// ============================================================

/** Compute Easter Sunday for a given year using the Anonymous Gregorian algorithm */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/** Get all 11 Luxembourg public holidays for a given year */
function getLuxembourgPublicHolidays(year: number): Date[] {
  const easter = easterSunday(year);
  const easterMs = easter.getTime();
  const day = 86400000;

  return [
    new Date(year, 0, 1),   // Nouvel An
    new Date(easterMs + 1 * day),  // Lundi de Pâques
    new Date(year, 4, 1),   // Fête du Travail
    new Date(year, 4, 9),   // Journée de l'Europe
    new Date(easterMs + 39 * day), // Ascension
    new Date(easterMs + 50 * day), // Lundi de Pentecôte
    new Date(year, 5, 23),  // Fête nationale
    new Date(year, 7, 15),  // Assomption
    new Date(year, 10, 1),  // Toussaint
    new Date(year, 11, 25), // Noël
    new Date(year, 11, 26), // Saint-Étienne
  ];
}

/** Count working days (Mon-Fri, excluding Luxembourg public holidays) in a given month */
export function getWorkingDaysInMonth(year: number, month: number): number {
  const holidays = getLuxembourgPublicHolidays(year);
  const holidaySet = new Set(holidays.map((d) => d.toISOString().split("T")[0]));

  const daysInMonth = new Date(year, month, 0).getDate();
  let count = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month - 1, d);
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue; // weekend
    const iso = date.toISOString().split("T")[0];
    if (holidaySet.has(iso)) continue; // public holiday
    count++;
  }

  return count;
}

/** Get workable hours in a month = working days x 8 */
export function getWorkableHoursInMonth(year: number, month: number): number {
  return getWorkingDaysInMonth(year, month) * 8;
}

// ============================================================
// Date helpers
// ============================================================

/** Last calendar day of a given month (1-indexed) as YYYY-MM-DD */
export function lastDayOfMonth(year: number, month: number): string {
  const d = new Date(year, month, 0);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Is the employee effectively on temporary exit at the given month-end date?
 * - Departure on the last day of the month = still active that month (starts next month)
 * - Return on the last day of the month = still on temp exit that month (active next month)
 */
export function isTempExitAt(
  e: { est_sortie_temporaire: boolean; date_sortie?: string | null; date_fin_sortie_temporaire?: string | null },
  monthEnd: string,
): boolean {
  return (
    e.est_sortie_temporaire &&
    (!e.date_sortie || e.date_sortie < monthEnd) &&
    (!e.date_fin_sortie_temporaire || monthEnd <= e.date_fin_sortie_temporaire)
  );
}

// ============================================================
// Types
// ============================================================

export interface Employee {
  code_salarie: string;
  date_entree: string | null;
  date_sortie: string | null;
  date_debut_sortie_temporaire?: string | null;
  date_fin_sortie_temporaire?: string | null;
  vehicle_type: string | null;
  taux_occupation: number;
  est_sortie_temporaire: boolean;
  description_motif_sortie: string;
  description_departement: string;
  description_equipe: string;
  description_fonction?: string | null;
  centre_cout?: string | null;
  description_service?: string | null;
}

export interface AbsenceRecord {
  code_salarie: string;
  mois: number;
  annee: number;
  pct_absenteisme: number;
  hrs_maladie: number;
  hrs_maternite: number;
  hrs_accident: number;
  heures_theoriques: number;
}

export interface ArrivalHypothesis {
  id: string;
  scenario_id: string;
  nb_personnes: number;
  taux_occupation: number;
  fonction: string | null;
  centre_cout: string | null;
  depot: string | null;
  type_contrat: "CDI" | "CDD";
  vehicle_type: "BUS" | "CAM" | null;
  start_day: number;
  start_month: number;
  start_year: number;
  end_day: number | null;
  end_month: number | null;
  end_year: number | null;
}

export interface TempExitHypothesis {
  id: string;
  scenario_id: string;
  nb_personnes: number;
  taux_occupation: number;
  fonction: string | null;
  centre_cout: string | null;
  depot: string | null;
  vehicle_type: "BUS" | "CAM" | null;
  motif: string;
  departure_day: number;
  departure_month: number;
  departure_year: number;
  return_day: number | null;
  return_month: number | null;
  return_year: number | null;
}

export interface DepartureHypothesis {
  id: string;
  scenario_id: string;
  code_salarie: string | null;
  nb_personnes: number;
  taux_occupation: number;
  fonction: string | null;
  centre_cout: string | null;
  depot: string | null;
  vehicle_type: "BUS" | "CAM" | null;
  departure_type: string;
  departure_day: number;
  departure_month: number;
  departure_year: number;
  is_from_data: boolean;
}

export interface ScenarioParams {
  turnover_rate: number; // annual %
  monthly_params: MonthlyParam[];
  monthly_turnover_params?: MonthlyTurnoverParam[];
  known_departures: KnownDeparture[];
  arrival_hypotheses: ArrivalHypothesis[];
  temp_exit_hypotheses: TempExitHypothesis[];
  departure_hypotheses: DepartureHypothesis[];
}

export interface MonthlyParam {
  mois: number;
  absenteeism_rate: number; // %
}

export interface MonthlyTurnoverParam {
  mois: number;
  turnover_rate: number; // annual %
}

export interface KnownDeparture {
  code_salarie: string | null;
  departure_type: string;
  departure_month: number;
  departure_year: number;
  return_month: number | null;
  return_year: number | null;
  vehicle_type: string | null;
  is_from_data: boolean;
}

export interface ProjectionMonth {
  month: number;
  month_label: string;
  effectif_brut: number;
  effectif_net: number;
  departures: number;
  arrivals: number;
  temp_exits: number;
  turnover_losses: number;
  absenteeism_rate: number;
  is_projection: boolean;
}

// ============================================================
// Arrival hypothesis helpers
// ============================================================

export function getArrivalsForMonth(
  hypotheses: ArrivalHypothesis[],
  month: number,
  year: number
): number {
  return hypotheses
    .filter((h) => h.start_month === month && h.start_year === year)
    .reduce((sum, h) => sum + h.nb_personnes, 0);
}

export function getCddDeparturesForMonth(
  hypotheses: ArrivalHypothesis[],
  month: number,
  year: number
): number {
  return hypotheses
    .filter((h) => {
      if (h.type_contrat !== "CDD") return false;
      // CDD auto-depart the month AFTER end of contract
      // (end_month is the last month the CDD is active)
      const endMonth = h.end_month ?? h.start_month;
      const endYear = h.end_year ?? h.start_year;
      const departMonth = endMonth === 12 ? 1 : endMonth + 1;
      const departYear = endMonth === 12 ? endYear + 1 : endYear;
      return departMonth === month && departYear === year;
    })
    .reduce((sum, h) => sum + h.nb_personnes, 0);
}

/** ETP of temp exit hypotheses departing in a given month */
export function getTempExitDeparturesForMonth(
  hypotheses: TempExitHypothesis[], month: number, year: number
): number {
  return hypotheses
    .filter((h) => h.departure_month === month && h.departure_year === year)
    .reduce((sum, h) => sum + h.nb_personnes * (h.taux_occupation / 100), 0);
}

/** ETP of temp exit hypotheses returning in a given month */
export function getTempExitReturnsForMonth(
  hypotheses: TempExitHypothesis[], month: number, year: number
): number {
  return hypotheses
    .filter((h) => h.return_month === month && h.return_year === year)
    .reduce((sum, h) => sum + h.nb_personnes * (h.taux_occupation / 100), 0);
}

// ============================================================
// Departure hypothesis helpers
// ============================================================

/** ETP of departure hypotheses for a given month (non-temp-exit types only) */
export function getDepartureHypothesesForMonth(
  hypotheses: DepartureHypothesis[],
  month: number,
  year: number
): { etp: number; codes: Set<string> } {
  const matching = hypotheses.filter(
    (h) => h.departure_month === month && h.departure_year === year && !h.is_from_data
  );
  const etp = matching.reduce((sum, h) => sum + h.nb_personnes * (h.taux_occupation / 100), 0);
  const codes = new Set<string>();
  matching.forEach((h) => { if (h.code_salarie) codes.add(h.code_salarie); });
  return { etp, codes };
}

// ============================================================
// Projection engine
// ============================================================

export function projectHeadcount(
  employees: Employee[],
  absences: AbsenceRecord[],
  scenario: ScenarioParams,
  year: number,
  targetTotal?: number
): ProjectionMonth[] {
  const currentDate = new Date();
  const currentMonth = currentDate.getMonth() + 1;
  const currentYear = currentDate.getFullYear();

  const result: ProjectionMonth[] = [];

  // Build monthly param lookup
  const monthParamMap = new Map<number, MonthlyParam>();
  scenario.monthly_params.forEach((mp) => monthParamMap.set(mp.mois, mp));

  // Build monthly turnover param lookup
  const monthTurnoverMap = new Map<number, MonthlyTurnoverParam>();
  if (scenario.monthly_turnover_params) {
    scenario.monthly_turnover_params.forEach((tp) => monthTurnoverMap.set(tp.mois, tp));
  }

  // Build known departures by month
  const departuresByMonth = new Map<number, KnownDeparture[]>();
  const returnsByMonth = new Map<number, KnownDeparture[]>();
  scenario.known_departures
    .filter((d) => d.departure_year === year)
    .forEach((d) => {
      const existing = departuresByMonth.get(d.departure_month) || [];
      existing.push(d);
      departuresByMonth.set(d.departure_month, existing);
    });
  // Returns from temp exits
  scenario.known_departures
    .filter((d) => d.return_year === year && d.return_month)
    .forEach((d) => {
      const existing = returnsByMonth.get(d.return_month!) || [];
      existing.push(d);
      returnsByMonth.set(d.return_month!, existing);
    });

  // Track running headcount
  let runningBrut = 0;

  for (let m = 1; m <= 12; m++) {
    const isProjection = year > currentYear || (year === currentYear && m > currentMonth);
    const monthEnd = lastDayOfMonth(year, m);

    const monthParam = monthParamMap.get(m) || {
      mois: m,
      absenteeism_rate: 5,
    };

    if (!isProjection) {
      // Real data: count from employee records
      const activeAtMonth = employees.filter((e) => {
        if (!e.date_entree || e.date_entree > monthEnd) return false;
        if (e.date_sortie && e.date_sortie < monthEnd) {
          // Keep if on temporary exit (will return)
          if (e.est_sortie_temporaire) return true;
          return false;
        }
        return true;
      });

      const tempExits = activeAtMonth.filter((e) => isTempExitAt(e, monthEnd)).length;
      const brut = activeAtMonth.length;

      // Use actual absence data if available
      const monthAbsences = absences.filter((a) => a.mois === m && a.annee === year);
      const absRate = monthAbsences.length > 0
        ? monthAbsences.reduce((sum, a) => sum + Number(a.pct_absenteisme), 0) / monthAbsences.length
        : 0;

      const absentCount = Math.round(brut * absRate / 100);
      const net = brut - absentCount;

      // Count departures this month (from real data)
      // If date_sortie is the last day of its month, effective departure is next month
      const monthDepartures = employees.filter((e) => {
        if (!e.date_sortie) return false;
        const d = new Date(e.date_sortie);
        let depMonth = d.getMonth() + 1;
        let depYear = d.getFullYear();
        const ldm = lastDayOfMonth(depYear, depMonth);
        if (e.date_sortie === ldm) {
          depMonth += 1;
          if (depMonth > 12) { depMonth = 1; depYear += 1; }
        }
        return depMonth === m && depYear === year;
      }).length;

      runningBrut = brut;

      result.push({
        month: m,
        month_label: FRENCH_MONTHS_SHORT[m],
        effectif_brut: brut,
        effectif_net: Math.max(0, net),
        departures: monthDepartures,
        arrivals: 0,
        temp_exits: tempExits,
        turnover_losses: 0,
        absenteeism_rate: absRate,
        is_projection: false,
      });
    } else {
      // Projection: apply scenario variables
      if (runningBrut === 0 && result.length > 0) {
        runningBrut = result[result.length - 1].effectif_brut;
      }
      if (runningBrut === 0) {
        // Fallback: count current active employees
        runningBrut = employees.filter((e) => !e.date_sortie || e.date_sortie >= monthEnd).length;
      }

      // Known departures this month (exclude temporary exits — they stay "sous contrat")
      const knownDeps = departuresByMonth.get(m) || [];
      const knownDepartureCount = knownDeps.filter((d) => !d.departure_type.startsWith("temp_exit")).length;

      // Turnover: monthly rate from annual rate (use per-month param if available)
      const annualTurnoverRate = monthTurnoverMap.get(m)?.turnover_rate ?? scenario.turnover_rate;
      const monthlyTurnoverRate = annualTurnoverRate / 100 / 12;
      const turnoverLosses = Math.round(runningBrut * monthlyTurnoverRate);

      // Arrivals from hypotheses
      const arrivals = getArrivalsForMonth(scenario.arrival_hypotheses, m, year);

      // CDD auto-departures
      const cddDepartures = getCddDeparturesForMonth(scenario.arrival_hypotheses, m, year);

      // Returns from temp exits
      const returns = returnsByMonth.get(m) || [];
      const returnCount = returns.length;

      // Also count known departures from data (employees with date_sortie in this month)
      // Exclude temporary exits — they stay "sous contrat"
      // If date_sortie is the last day of its month, effective departure is next month
      const dataExits = employees.filter((e) => {
        if (!e.date_sortie || e.est_sortie_temporaire) return false;
        const d = new Date(e.date_sortie);
        let depMonth = d.getMonth() + 1;
        let depYear = d.getFullYear();
        const ldm = lastDayOfMonth(depYear, depMonth);
        if (e.date_sortie === ldm) {
          depMonth += 1;
          if (depMonth > 12) { depMonth = 1; depYear += 1; }
        }
        return depMonth === m && depYear === year;
      }).length;

      // Departure hypotheses for this month
      const depHyp = getDepartureHypothesesForMonth(scenario.departure_hypotheses, m, year);
      // Avoid double-counting: if a departure hypothesis has a code_salarie matching a dataExit, don't count it twice
      let adjustedDataExits = dataExits;
      if (depHyp.codes.size > 0) {
        const dataExitCodes = employees.filter((e) => {
          if (!e.date_sortie || e.est_sortie_temporaire) return false;
          const d = new Date(e.date_sortie);
          let depMonth = d.getMonth() + 1;
          let depYear = d.getFullYear();
          const ldm2 = lastDayOfMonth(depYear, depMonth);
          if (e.date_sortie === ldm2) {
            depMonth += 1;
            if (depMonth > 12) { depMonth = 1; depYear += 1; }
          }
          return depMonth === m && depYear === year;
        });
        const overlapping = dataExitCodes.filter((e) => depHyp.codes.has(e.code_salarie)).length;
        adjustedDataExits = Math.max(0, dataExits - overlapping);
      }

      const totalDepartures = Math.max(knownDepartureCount, adjustedDataExits) + turnoverLosses + cddDepartures + depHyp.etp;

      runningBrut = runningBrut - totalDepartures + arrivals + returnCount;
      runningBrut = Math.max(0, runningBrut);

      // Temp exits: estimate from last known data + hypotheses
      const lastTempExits = result.length > 0 ? result[result.length - 1].temp_exits : 0;
      const tempExitHypDepartures = getTempExitDeparturesForMonth(scenario.temp_exit_hypotheses, m, year);
      const tempExitHypReturns = getTempExitReturnsForMonth(scenario.temp_exit_hypotheses, m, year);
      const tempExitsProjected = Math.max(0, lastTempExits - returnCount + tempExitHypDepartures - tempExitHypReturns);

      // Le taux d'absentéisme du scénario impacte le MCT, pas le CNS
      // → effectif_net n'est pas réduit par l'absentéisme
      const net = runningBrut;

      result.push({
        month: m,
        month_label: FRENCH_MONTHS_SHORT[m],
        effectif_brut: runningBrut,
        effectif_net: Math.max(0, net),
        departures: totalDepartures,
        arrivals,
        temp_exits: tempExitsProjected,
        turnover_losses: turnoverLosses,
        absenteeism_rate: monthParam.absenteeism_rate,
        is_projection: true,
      });
    }
  }

  return result;
}

// ============================================================
// Historical analysis helpers
// ============================================================

export function calculateHistoricalAbsenteeism(
  absences: AbsenceRecord[]
): { mois: number; avg_rate: number; years: number[] }[] {
  const byMonth = new Map<number, { rates: number[]; years: Set<number> }>();

  absences.forEach((a) => {
    const existing = byMonth.get(a.mois) || { rates: [], years: new Set() };
    existing.rates.push(Number(a.pct_absenteisme));
    existing.years.add(a.annee);
    byMonth.set(a.mois, existing);
  });

  return Array.from(byMonth.entries())
    .map(([mois, data]) => ({
      mois,
      avg_rate: data.rates.reduce((s, r) => s + r, 0) / data.rates.length,
      years: [...data.years],
    }))
    .sort((a, b) => a.mois - b.mois);
}

export function calculateHistoricalTurnover(
  employees: Employee[],
  year: number
): number {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const activeAtStart = employees.filter((e) => {
    if (!e.date_entree || e.date_entree > yearStart) return false;
    if (e.date_sortie && e.date_sortie < yearStart) return false;
    return true;
  }).length;

  const departures = employees.filter((e) => {
    if (!e.date_sortie) return false;
    return e.date_sortie >= yearStart && e.date_sortie <= yearEnd;
  }).length;

  if (activeAtStart === 0) return 0;
  return (departures / activeAtStart) * 100;
}

export function detectKnownDeparturesFromData(
  employees: Employee[],
  year: number
): KnownDeparture[] {
  const today = new Date().toISOString().split("T")[0];

  return employees
    .filter((e) => {
      if (!e.date_sortie || e.date_sortie < today) return false;
      const d = new Date(e.date_sortie);
      return d.getFullYear() === year;
    })
    .map((e) => {
      const exitDate = new Date(e.date_sortie!);
      const motif = e.description_motif_sortie || "";

      let departureType = "end_contract";
      if (motif.includes("retraite") || motif.includes("Pension")) departureType = "retirement";
      else if (motif.includes("Parental")) departureType = "temp_exit_parental";
      else if (motif.includes("maternit")) departureType = "temp_exit_maternity";
      else if (motif.includes("Congé sans") || motif.includes("accompagnement")) departureType = "temp_exit_other";
      else if (motif.includes("Licenciement") || motif.includes("Demission") || motif.includes("siliation")) departureType = "turnover";

      let depMonth = exitDate.getMonth() + 1;
      let depYear = exitDate.getFullYear();
      const ldm = lastDayOfMonth(depYear, depMonth);
      if (e.date_sortie === ldm) {
        depMonth += 1;
        if (depMonth > 12) { depMonth = 1; depYear += 1; }
      }

      return {
        code_salarie: e.code_salarie,
        departure_type: departureType,
        departure_month: depMonth,
        departure_year: depYear,
        return_month: null,
        return_year: null,
        vehicle_type: e.vehicle_type,
        is_from_data: true,
      };
    });
}
