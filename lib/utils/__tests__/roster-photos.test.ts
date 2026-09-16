import { describe, expect, it } from "vitest";
import { ajouterPhotoSiAbsente, indexerPhotos, periodesDesPhotos, photoPourLeMois } from "../roster-photos";

const l = (code: string, mois: number, annee = 2026) => ({ code_salarie: code, mois, annee });

describe("indexerPhotos / periodesDesPhotos", () => {
  it("regroupe par période et accepte mois/annee en chaînes", () => {
    const photos = indexerPhotos([l("A", 3), l("B", 3), { code_salarie: "C", mois: "8", annee: "2026" }]);
    expect(photos.size).toBe(2);
    expect(periodesDesPhotos(photos)).toEqual(
      expect.arrayContaining([{ mois: 3, annee: 2026 }, { mois: 8, annee: 2026 }])
    );
  });

  it("retrouve l'année et le mois depuis le rang, y compris décembre", () => {
    const photos = indexerPhotos([l("A", 12, 2025), l("B", 1, 2026)]);
    expect(periodesDesPhotos(photos)).toEqual(
      expect.arrayContaining([{ mois: 12, annee: 2025 }, { mois: 1, annee: 2026 }])
    );
  });
});

describe("photoPourLeMois", () => {
  const photos = indexerPhotos([l("A", 3), l("B", 3), l("C", 8)]);

  it("lit le mois dans sa propre photo", () => {
    const r = photoPourLeMois(photos, 8, 2026);
    expect(r.exacte).toBe(true);
    expect(r.lignes.map((x) => x.code_salarie)).toEqual(["C"]);
  });

  it("reconduit la photo antérieure la plus récente pour un mois sans photo, même futur", () => {
    expect(photoPourLeMois(photos, 5, 2026).lignes.map((x) => x.code_salarie)).toEqual(["A", "B"]);
    const futur = photoPourLeMois(photos, 12, 2026);
    expect(futur.exacte).toBe(false);
    expect(futur.periode).toEqual({ mois: 8, annee: 2026 });
  });

  it("rend une liste vide sans aucune photo", () => {
    expect(photoPourLeMois(new Map(), 1, 2026)).toEqual({ lignes: [], periode: null, exacte: false });
  });
});

describe("ajouterPhotoSiAbsente", () => {
  it("ajoute une photo de repli d'une autre année sans écraser une photo existante", () => {
    const photos = indexerPhotos([l("A", 3)]);
    ajouterPhotoSiAbsente(photos, { mois: 12, annee: 2025 }, [l("Z", 12, 2025)]);
    ajouterPhotoSiAbsente(photos, { mois: 3, annee: 2026 }, [l("Y", 3)]);
    ajouterPhotoSiAbsente(photos, null, [l("X", 1)]);
    expect(photos.size).toBe(2);
    expect(photoPourLeMois(photos, 1, 2026).periode).toEqual({ mois: 12, annee: 2025 });
    expect(photoPourLeMois(photos, 3, 2026).lignes.map((x) => x.code_salarie)).toEqual(["A"]);
  });
});
