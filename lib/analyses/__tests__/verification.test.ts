import { describe, expect, it } from "vitest";
import { nombresDuTexte, verifierNombres } from "../verification";
import type { DeckSpec } from "../deck-spec";

const sorties = [{ overall: { long_days_per_driver: 2.4583, drivers_paid: 1250, long_days_total: 3076, share_with_long_days_pct: 55.8 }, by_depot: [{ depot: "Allerborn", deviation_from_average_pct: 65.9, share: 0.465 }] }];

const deck = (slides: DeckSpec["slides"]): DeckSpec => ({ topic: "t", slides });

describe("nombresDuTexte", () => {
  it("lit milliers, décimales et signes, ignore années, P2/D10, petits entiers et 11 h", () => {
    expect(nombresDuTexte("3,076 long days in July 2026, P2, D10, top 10, days over 12 h: −79% and 2.46").map((n) => n.valeur)).toEqual([3076, -79, 2.46]);
  });
});

describe("verifierNombres", () => {
  it("accepte les valeurs des outils à l'arrondi d'affichage près", () => {
    const d = deck([
      { type: "kpis", title: "Key", items: [{ label: "Drivers", value: "1,250", note: "55.8% with long days, avg 2.46" }], commentary: "Allerborn +66% above average; top 10% carry 46.5%.", sources: [] },
      { type: "bar_chart", title: "x", categories: ["a"], series: [{ name: "s", values: [2.46] }], reference: { label: "avg", value: 2.46 }, valueFormat: "two_decimals", sources: [] },
      { type: "limits", title: "Limits", items: ["Data from 2026 only."] },
    ]);
    expect(verifierNombres(d, sorties)).toEqual([]);
  });

  it("signale un nombre absent des sorties", () => {
    const d = deck([
      { type: "findings", title: "x", items: [{ headline: "Allerborn", detail: "is 72% above average with 4.9 long days" }], sources: [] },
      { type: "limits", title: "Limits", items: ["none"] },
    ]);
    expect(verifierNombres(d, sorties).map((e) => e.nombre)).toEqual(["72", "4.9"]);
  });

  it("vérifie aussi les valeurs des graphiques", () => {
    const d = deck([
      { type: "bar_chart", title: "x", categories: ["a"], series: [{ name: "s", values: [3076, 3999] }], valueFormat: "integer", sources: [] },
      { type: "limits", title: "Limits", items: ["none"] },
    ]);
    expect(verifierNombres(d, sorties)).toEqual([{ slide: 1, champ: "series[0].values[1]", nombre: "3999" }]);
  });
});
