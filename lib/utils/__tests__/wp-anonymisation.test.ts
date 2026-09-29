import { describe, expect, it } from "vitest";
import { regrouperPetitsGroupes } from "../wp-anonymisation";

type G = { cle: string; n: number };
const fusion = (gs: G[]): G => ({ cle: "Autres", n: gs.reduce((s, g) => s + g.n, 0) });
const regrouper = (gs: G[]) => regrouperPetitsGroupes(gs, (g) => g.n, fusion);

describe("regrouperPetitsGroupes (seuil 3)", () => {
  it("laisse intacts des groupes tous au-dessus du seuil", () => {
    const gs = [{ cle: "A", n: 5 }, { cle: "B", n: 3 }];
    expect(regrouper(gs)).toBe(gs);
  });

  it("fond les groupes de 1 et 2 personnes en « Autres », après les groupes conservés", () => {
    expect(regrouper([{ cle: "A", n: 10 }, { cle: "B", n: 1 }, { cle: "C", n: 2 }, { cle: "D", n: 4 }])).toEqual([
      { cle: "A", n: 10 }, { cle: "D", n: 4 }, { cle: "Autres", n: 3 },
    ]);
  });

  it("un « Autres » sous le seuil absorbe le plus petit des groupes restants", () => {
    expect(regrouper([{ cle: "A", n: 10 }, { cle: "B", n: 1 }, { cle: "C", n: 4 }])).toEqual([
      { cle: "A", n: 10 }, { cle: "Autres", n: 5 },
    ]);
  });
});
