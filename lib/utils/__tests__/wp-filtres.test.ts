import { describe, expect, it } from "vitest";
import { lireFiltresWorkforce } from "../wp-filtres";

const e = (extra: Record<string, string | null> = {}) => ({ code_salarie: "A", description_fonction: "Chauffeur", centre_cout: "CC1", description_service: "Depots - Mersch", description_equipe: "E1", ...extra });

describe("lireFiltresWorkforce", () => {
  it("sans paramètre, tout passe et les filtres sont inactifs", () => {
    const f = lireFiltresWorkforce({});
    expect(f.actifs).toBe(false);
    expect(f.passe(e())).toBe(true);
  });

  it("lit les listes séparées par ||| et filtre sur chaque axe", () => {
    const f = lireFiltresWorkforce({ depots: "Depots - Mersch|||Depots - Hosingen", cc: "CC1" });
    expect(f.actifs).toBe(true);
    expect(f.depots).toEqual(["Depots - Mersch", "Depots - Hosingen"]);
    expect(f.passe(e())).toBe(true);
    expect(f.passe(e({ description_service: "Depots - Allerborn" }))).toBe(false);
    expect(f.passe(e({ centre_cout: "CC2" }))).toBe(false);
  });

  it("__none__ ne laisse rien passer, et le salarié filtre par code", () => {
    expect(lireFiltresWorkforce({ fonctions: "__none__" }).passe(e())).toBe(false);
    const f = lireFiltresWorkforce({ employee: "B" });
    expect(f.passe(e())).toBe(false);
    expect(f.passe(e({ code_salarie: "B" }))).toBe(true);
  });
});
