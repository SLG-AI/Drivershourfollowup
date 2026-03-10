import { createClient } from "@/lib/supabase/server";
import { TargetsClient } from "./targets-client";

export default async function TargetsPage() {
  const supabase = await createClient();

  const [{ data: targets }, { data: employees }, { data: currentCounts }] = await Promise.all([
    supabase
      .from("wp_target_needs")
      .select("*")
      .order("vehicle_type")
      .order("depot")
      .order("work_time"),
    supabase
      .from("wp_employees")
      .select("description_departement")
      .not("description_departement", "is", null)
      .not("description_departement", "eq", ""),
    supabase
      .from("wp_employees")
      .select("vehicle_type, description_departement, taux_occupation, date_sortie, est_sortie_temporaire"),
  ]);

  // Extract unique depots
  const depots = [...new Set((employees || []).map((e) => e.description_departement as string))].filter(Boolean).sort();

  // Compute current headcounts for comparison
  const today = new Date().toISOString().split("T")[0];
  const active = (currentCounts || []).filter((e) => !e.date_sortie || e.date_sortie >= today);

  const currentByKey = new Map<string, { headcount: number; etp: number }>();

  active.forEach((e) => {
    const vt = e.vehicle_type || "AUTRE";
    const depot = e.description_departement || "";
    const wt = Number(e.taux_occupation) >= 80 ? "full_time" : "part_time";
    const key = `${vt}|${depot}|${wt}`;
    const existing = currentByKey.get(key) || { headcount: 0, etp: 0 };
    existing.headcount++;
    existing.etp += Number(e.taux_occupation) / 100;
    currentByKey.set(key, existing);
  });

  // Build current counts array
  const currentCountsArray = [...currentByKey.entries()].map(([key, counts]) => {
    const [vehicle_type, depot, work_time] = key.split("|");
    return { vehicle_type, depot, work_time, ...counts };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Besoins cibles</h1>
        <p className="text-muted-foreground">
          Définissez les effectifs cibles par type de véhicule, dépôt et temps de travail.
        </p>
      </div>
      <TargetsClient
        initialTargets={(targets || []).map((t) => ({
          vehicle_type: t.vehicle_type,
          depot: t.depot || "",
          work_time: t.work_time,
          target_headcount: Number(t.target_headcount),
          target_etp: t.target_etp ? Number(t.target_etp) : null,
        }))}
        depots={depots}
        currentCounts={currentCountsArray}
      />
    </div>
  );
}
