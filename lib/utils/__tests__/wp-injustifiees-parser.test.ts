import { describe, expect, it } from "vitest";
import { detectFileType, parseAbsencesInjustifiees } from "../wp-excel-parser";

const ENTETES = ["Code Salarié", "Nom / Prénom", "Mois", "Début de l'Absence", "Fin de l'Absence", "Nombre d'Heures d'Absence", "Complète"];

function csv(lignes: string[][], separateur: string, finDeLigne = "\r\n"): ArrayBuffer {
  const texte = lignes.map((l) => l.join(separateur)).join(finDeLigne);
  return new TextEncoder().encode(texte).buffer as ArrayBuffer;
}

const LIGNES = [
  ["SLA 0001", "SLA 0001", "Septembre", "19.09.2025", "19.09.2025", "8", "VRAI"],
  ["SLA 0002", "SLA 0002", "Septembre", "16.09.2025", "17.09.2025", "16", "False"],
];

describe("parseAbsencesInjustifiees — séparateur", () => {
  it("lit l'export d'origine, séparé par des virgules et entre guillemets", () => {
    const fichier = csv([ENTETES, ...LIGNES].map((l) => l.map((c) => `"${c}"`)), ",");
    const res = parseAbsencesInjustifiees(fichier);
    expect(res.errors).toEqual([]);
    expect(res.rowCount).toBe(2);
  });

  it("lit un CSV réenregistré par Excel en français (points-virgules)", () => {
    const res = parseAbsencesInjustifiees(csv([ENTETES, ...LIGNES], ";"));
    expect(res.errors).toEqual([]);
    expect(res.data).toEqual([
      expect.objectContaining({ code_salarie: "SLA 0001", mois: 9, annee: 2025, date_debut: "2025-09-19", duree_hrs: 8, complete: true }),
      expect.objectContaining({ code_salarie: "SLA 0002", mois: 9, annee: 2025, date_fin: "2025-09-17", duree_hrs: 16, complete: false }),
    ]);
  });

  it("accepte les dates JJ/MM/AAAA", () => {
    const lignes = LIGNES.map((l) => l.map((c) => c.replace(/\./g, "/")));
    const res = parseAbsencesInjustifiees(csv([ENTETES, ...lignes], ";"));
    expect(res.rowCount).toBe(2);
    expect(res.data[0]).toMatchObject({ date_debut: "2025-09-19", mois: 9, annee: 2025 });
  });
});

describe("detectFileType — absences injustifiées", () => {
  it("reconnaît le CSV réenregistré par Excel (UTF-8 sans BOM, points-virgules)", () => {
    expect(detectFileType(csv([ENTETES, ...LIGNES], ";"))).toBe("absences_injustifiees");
  });
});
