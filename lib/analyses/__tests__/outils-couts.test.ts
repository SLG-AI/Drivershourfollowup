import { describe, expect, it } from "vitest";
import type { DonneesAnalyse } from "../donnees";
import type { DonneesCouts } from "../donnees-workforce";
import { coutsInterim } from "../outils-couts";

const cout = (code: string, mois: number, montant: number, heures: number) => [
  { code_salarie: code, mois, annee: 2026, composante: "base", quantite: heures, montant_facturable: montant },
];
const roster = (code: string, mois: number, depot: string) => ({ code_salarie: code, mois, annee: 2026, centre_cout: "CC1", description_service: depot });

function donnees(co: Partial<DonneesCouts>): DonneesAnalyse {
  const couts: DonneesCouts = { stats: [], lignes: [], bruts: new Map(), interimCouts: [], interimRoster: [], ...co };
  return { couts: async () => couts } as unknown as DonneesAnalyse;
}

describe("coutsInterim", () => {
  const d = donnees({
    interimCouts: [
      ...cout("I1", 9, 1000, 100), ...cout("I2", 9, 2000, 150), ...cout("I3", 9, 500, 40),
      ...cout("I4", 9, 300, 20), ...cout("I1", 10, 1100, 110),
    ],
    interimRoster: [
      roster("I1", 9, "Depots - Mersch"), roster("I2", 9, "Depots - Mersch"), roster("I3", 9, "Depots - Mersch"),
      roster("I4", 9, "Depots - Hosingen"), roster("I1", 10, "Depots - Mersch"),
    ],
  });

  it("totalise par mois et fusionne les dépôts de moins de 3 intérimaires", async () => {
    const r = (await coutsInterim(d, { year: 2026 })) as Exclude<Awaited<ReturnType<typeof coutsInterim>>, { error: string }>;
    expect(r.by_month.map((m) => [m.month, m.cost_eur, m.hours, m.workers])).toEqual([["Sep 2026", 3800, 310, 4], ["Oct 2026", 1100, 110, 1]]);
    expect(r.total.cost_eur).toBe(4900);
    // Hosingen (1 intérimaire) ne doit jamais apparaître seul
    expect(r.by_depot.map((g) => g.depot)).not.toContain("Hosingen");
    expect(r.by_depot.every((g) => g.workers >= 3)).toBe(true);
  });

  it("explique l'absence de données", async () => {
    expect(await coutsInterim(d, { year: 2025 })).toEqual({ error: "No interim cost data for 2025. Interim years: 2026." });
  });
});
