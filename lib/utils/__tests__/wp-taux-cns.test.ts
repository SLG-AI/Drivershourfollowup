import { describe, expect, it } from "vitest";
import { controlerTauxCns, messagesControleTauxCns, plafonnerTauxCns } from "../wp-taux-cns";

describe("plafonnerTauxCns", () => {
  it("ramène à 100 % un taux supérieur et garde la valeur du fichier", () => {
    const [l] = plafonnerTauxCns([{ code_salarie: "A", pct_absenteisme: 147.62, hrs_maladie: 248 }]);
    expect(l.pct_absenteisme).toBe(100);
    expect(l.pct_absenteisme_source).toBe(147.62);
    expect(l.hrs_maladie).toBe(248); // les heures restent celles du fichier
  });

  it("laisse intacts les taux normaux, à 100 % pile, nuls ou illisibles", () => {
    const lignes = [{ pct_absenteisme: 52.38 }, { pct_absenteisme: 100 }, { pct_absenteisme: null }, { pct_absenteisme: "abc" }];
    const r = plafonnerTauxCns(lignes);
    r.forEach((l, i) => {
      expect(l).toBe(lignes[i]);
      expect(l.pct_absenteisme_source).toBeUndefined();
    });
  });

  it("accepte un taux fourni en chaîne (numeric PostgREST)", () => {
    const [l] = plafonnerTauxCns([{ pct_absenteisme: "117.39" }]);
    expect(l.pct_absenteisme).toBe(100);
    expect(l.pct_absenteisme_source).toBe(117.39);
  });
});

describe("controlerTauxCns", () => {
  const lignes = [
    { code_salarie: "A", pct_absenteisme: 147.62, hrs_maladie: 248, heures_theoriques: 168 },
    { code_salarie: "B", pct_absenteisme: 52.38, hrs_maladie: 88, heures_theoriques: 168 },
    { code_salarie: "C", pct_absenteisme: 107.1, hrs_maladie: 100, hrs_accident: 80, heures_theoriques: 168 },
  ];

  it("ne retient que les taux au-dessus de 100 %, les plus forts d'abord, heures cumulées", () => {
    const a = controlerTauxCns(lignes);
    expect(a.map((x) => x.code_salarie)).toEqual(["A", "C"]);
    expect(a[1].heuresAbsence).toBe(180);
  });

  it("rédige un seul avertissement, et aucun quand tout est normal", () => {
    expect(messagesControleTauxCns(controlerTauxCns([lignes[1]]))).toEqual([]);
    const [m] = messagesControleTauxCns(controlerTauxCns(lignes));
    expect(m).toContain("2 salariés ont un taux d'absence supérieur à 100 %");
    expect(m).toContain("A 147,6 % (248 h d'absence pour 168 h théoriques)");
  });

  it("résume les exemples au-delà du maximum", () => {
    const beaucoup = Array.from({ length: 5 }, (_, i) => ({ code_salarie: `S${i}`, pct_absenteisme: 110 + i, heures_theoriques: 168 }));
    expect(messagesControleTauxCns(controlerTauxCns(beaucoup))[0]).toContain("et 2 autres");
  });
});
