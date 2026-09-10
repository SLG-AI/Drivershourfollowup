import { describe, expect, it } from "vitest";
import { estJourDeWeekEnd, horsWeekEnd } from "../wp-calculations";

describe("estJourDeWeekEnd", () => {
  it("reconnaît samedi et dimanche", () => {
    expect(estJourDeWeekEnd("2026-08-01")).toBe(true); // samedi
    expect(estJourDeWeekEnd("2026-08-02")).toBe(true); // dimanche
    expect(estJourDeWeekEnd("2026-08-03")).toBe(false); // lundi
    expect(estJourDeWeekEnd("2026-08-07")).toBe(false); // vendredi
  });

  it("accepte un horodatage complet et ignore une date absente ou invalide", () => {
    expect(estJourDeWeekEnd("2026-08-02T00:00:00+00:00")).toBe(true);
    expect(estJourDeWeekEnd(null)).toBe(false);
    expect(estJourDeWeekEnd(undefined)).toBe(false);
    expect(estJourDeWeekEnd("n/a")).toBe(false);
  });
});

describe("horsWeekEnd", () => {
  it("écarte les lignes du week-end et garde les autres, sans date comprise", () => {
    const rows = [
      { code_salarie: "1", date_absence: "2026-08-03", duree_hrs: 8 },
      { code_salarie: "1", date_absence: "2026-08-08", duree_hrs: 8 },
      { code_salarie: "2", date_absence: null, duree_hrs: 4 },
    ];
    expect(horsWeekEnd(rows).map((r) => r.date_absence)).toEqual(["2026-08-03", null]);
  });
});
