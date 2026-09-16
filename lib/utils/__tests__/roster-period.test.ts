import { describe, expect, it } from "vitest";
import { choisirPeriodeRoster, rangPeriode, type RosterPeriod } from "../roster-period";

const p = (mois: number, annee = 2026): RosterPeriod => ({ mois, annee });

describe("rangPeriode", () => {
  it("ordonne les mois à travers les années", () => {
    expect(rangPeriode(p(12, 2025))).toBeLessThan(rangPeriode(p(1, 2026)));
    expect(rangPeriode(p(3)) - rangPeriode(p(1))).toBe(2);
  });
});

describe("choisirPeriodeRoster", () => {
  const periodes = [p(8), p(7), p(3), p(12, 2025)];

  it("retient la photo exacte quand elle existe", () => {
    expect(choisirPeriodeRoster(periodes, 7, 2026)).toEqual({ periode: p(7), exacte: true });
  });

  it("reconduit la photo la plus récente ANTÉRIEURE quand le mois manque", () => {
    expect(choisirPeriodeRoster(periodes, 5, 2026)).toEqual({ periode: p(3), exacte: false });
    expect(choisirPeriodeRoster(periodes, 11, 2026)).toEqual({ periode: p(8), exacte: false });
    // à cheval sur l'année
    expect(choisirPeriodeRoster(periodes, 1, 2026)).toEqual({ periode: p(12, 2025), exacte: false });
  });

  it("ne remonte jamais vers une photo future tant qu'une antérieure existe", () => {
    expect(choisirPeriodeRoster([p(8), p(3)], 5, 2026).periode).toEqual(p(3));
  });

  it("prend la plus ancienne en dernier recours seulement", () => {
    expect(choisirPeriodeRoster([p(8), p(3)], 1, 2026)).toEqual({ periode: p(3), exacte: false });
  });

  it("accepte des périodes non triées", () => {
    expect(choisirPeriodeRoster([p(3), p(8), p(7)], 6, 2026).periode).toEqual(p(3));
    expect(choisirPeriodeRoster([p(3), p(8), p(7)], 9, 2026).periode).toEqual(p(8));
  });

  it("rend null sans aucune photo", () => {
    expect(choisirPeriodeRoster([], 6, 2026)).toEqual({ periode: null, exacte: false });
  });
});
