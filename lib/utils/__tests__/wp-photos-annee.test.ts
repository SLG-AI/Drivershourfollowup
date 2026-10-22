import { describe, expect, it } from "vitest";
import { indexerPhotos } from "../roster-photos";
import { codesAvecMaladieCns, preparerPhotosAnnee } from "../wp-photos-annee";

interface Ligne {
  code_salarie: string;
  mois: number;
  annee: number;
  date_entree: string | null;
  date_sortie: string | null;
  est_sortie_temporaire: boolean;
  description_motif_sortie: string;
  taux_occupation: number;
  description_service: string;
}

const ligne = (code: string, mois: number, extra: Partial<Ligne> = {}): Ligne => ({
  code_salarie: code, mois, annee: 2026, date_entree: "2020-01-01", date_sortie: null,
  est_sortie_temporaire: false, description_motif_sortie: "", taux_occupation: 100, description_service: "Depot A", ...extra,
});

const preparer = (lignes: Ligne[], extra: { codesMaladie?: Set<string>; passe?: (e: Ligne) => boolean } = {}) =>
  preparerPhotosAnnee({
    annee: 2026,
    photosParRang: indexerPhotos(lignes),
    photoAffichee: [],
    passe: extra.passe ?? (() => true),
    codesMaladie: extra.codesMaladie ?? new Set(),
    sortiesConstateesSur: () => new Map(),
  });

describe("codesAvecMaladieCns", () => {
  it("ne retient que les heures maladie positives, sur toutes les listes", () => {
    const codes = codesAvecMaladieCns([{ code_salarie: "A", hrs_maladie: 8 }, { code_salarie: "B", hrs_maladie: 0 }], [{ code_salarie: 7, hrs_maladie: "4" }]);
    expect([...codes].sort()).toEqual(["7", "A"]);
  });
});

describe("preparerPhotosAnnee", () => {
  it("lit chaque mois dans sa photo, reconduit la plus récente antérieure, filtre le périmètre", () => {
    const p = preparer(
      [ligne("A", 1), ligne("B", 1, { description_service: "Depot B" }), ligne("A", 3), ligne("C", 3)],
      { passe: (e) => e.description_service === "Depot A" }
    );
    expect(p.photoDuMois(1).map((e) => e.code_salarie)).toEqual(["A"]);
    expect(p.photoDuMois(2).map((e) => e.code_salarie)).toEqual(["A"]);
    expect(p.photoDuMois(5).map((e) => e.code_salarie)).toEqual(["A", "C"]);
    expect(p.photoExacte(2, 2026)).toBe(false);
    expect(p.photoExacte(3, 2026)).toBe(true);
  });

  it("reclassifie une sortie temporaire non structurelle avec heures maladie en absent maladie", () => {
    const p = preparer([ligne("A", 1, { est_sortie_temporaire: true, description_motif_sortie: "Autre" })], { codesMaladie: new Set(["A"]) });
    expect(p.photoDuMois(1)[0].est_sortie_temporaire).toBe(false);
  });

  it("reprend les sortis du mois absents de sa photo, seulement entre deux photos exactes", () => {
    const lignes = [ligne("A", 1), ligne("B", 1, { date_sortie: "2026-02-14", taux_occupation: 50 }), ligne("A", 2), ligne("A", 4)];
    const p = preparer(lignes);
    expect(p.sortisHorsPhotoPour(2)).toEqual([{ date_sortie: "2026-02-14", taux_occupation: 50 }]);
    // Mars n'a pas sa photo, avril compare à une photo reconduite : rien
    expect(p.sortisHorsPhotoPour(3)).toEqual([]);
    expect(p.sortisHorsPhotoPour(4)).toEqual([]);
    // Les mêmes, en lignes de la photo précédente datées de leur sortie, sans toucher la photo
    expect(p.salariesSortisHorsPhotoPour(2)).toEqual([{ ...lignes[1], date_sortie: "2026-02-14", est_sortie_temporaire: false }]);
    expect(p.salariesSortisHorsPhotoPour(3)).toEqual([]);
  });
});
