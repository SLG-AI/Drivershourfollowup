import { describe, expect, it } from "vitest";
import { indexerPhotos } from "../roster-photos";
import { getWorkableHoursInMonth } from "../wp-calculations";
import { analyserDisponibilite } from "../wp-disponibilite";

const ligne = (code: string, mois: number) => ({
  code_salarie: code, mois, annee: 2026, date_entree: "2020-01-01", date_sortie: null,
  est_sortie_temporaire: false, description_motif_sortie: "", taux_occupation: 100,
});
const conge = (code: string, date: string, hrs: number, categorie = "conges") => ({
  code_salarie: code, date_conge: date, duree_hrs: hrs, categorie, mois: Number(date.slice(5, 7)), annee: 2026,
});
const mct = (code: string, date: string, hrs = 8) => ({ code_salarie: code, date_absence: date, duree_hrs: hrs, mois: Number(date.slice(5, 7)), annee: 2026 });

describe("analyserDisponibilite", () => {
  // 10 salariés à temps plein en août et septembre
  const codes = Array.from({ length: 10 }, (_, i) => `S${i}`);
  const photos = indexerPhotos([...codes.map((c) => ligne(c, 8)), ...codes.map((c) => ligne(c, 9))]);
  const wAout = getWorkableHoursInMonth(2026, 8);
  const r = analyserDisponibilite(
    2026,
    [7, 8, 9],
    photos,
    [],
    [mct("S0", "2026-07-01"), mct("S0", "2026-08-03", wAout / 2), mct("S0", "2026-09-01", 0)],
    [],
    [
      // Août : 1 ETP de congés + 0,5 ETP de récup, un congé de samedi écarté, un hors photo écarté
      conge("S1", "2026-08-04", wAout),
      conge("S2", "2026-08-05", wAout / 2, "extraordinaire"),
      conge("S3", "2026-08-08", 8),
      conge("ZZ", "2026-08-06", 8),
      // Septembre : congés des supports seulement (mois non complet)
      conge("S4", "2026-09-02", 8),
    ],
    new Set([8]),
    false
  );
  const mois = (m: number) => r.parMois.find((x) => x.mois === m)!;

  it("retire congés et extraordinaires de l'effectif après MCT sur un mois complet", () => {
    expect(mois(8).sousContrat).toBe(10);
    expect(mois(8).apresMct).toBe(9.5);
    expect(mois(8).etpConges).toBe(1);
    expect(mois(8).etpExtra).toBe(0.5);
    expect(mois(8).disponible).toBe(8);
    expect(mois(8).tauxConges).toBe(15);
  });

  it("n'affiche ni congés ni disponible sur un mois partiel", () => {
    expect(mois(9)).toMatchObject({ sousContrat: 10, disponible: null, etpConges: null, heuresConges: null, tauxConges: null });
  });

  it("ne synthétise que les mois complets", () => {
    // Juillet reconduit la photo la plus ancienne mais n'a aucun congé complet
    expect(mois(7).disponible).toBeNull();
    expect(r.moisComplets).toEqual([8]);
    expect(r.disponibleMoyen).toBe(8);
    expect(r.tauxCongesMoyen).toBe(15);
    expect(r.moisPlusCharge).toEqual({ mois: 8, etp: 1.5 });
  });

  it("sans mois complet, la synthèse est vide", () => {
    const vide = analyserDisponibilite(2026, [9, 10], photos, [], [mct("S0", "2026-09-01")], [], [conge("S4", "2026-09-02", 8)], new Set(), false);
    expect(vide.disponibleMoyen).toBeNull();
    expect(vide.tauxCongesMoyen).toBeNull();
    expect(vide.moisPlusCharge).toBeNull();
    // Octobre n'a aucune absence MCT : omis
    expect(vide.parMois.map((x) => x.mois)).toEqual([9]);
  });
});
