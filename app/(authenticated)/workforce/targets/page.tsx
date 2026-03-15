import { createClient } from "@/lib/supabase/server";
import { TargetsClient } from "./targets-client";

export default async function TargetsPage() {
  const supabase = await createClient();

  const [{ data: targets }, { data: employees }, { data: currentCounts }] = await Promise.all([
    supabase
      .from("wp_target_needs")
      .select("*")
      .order("depot")
      .order("work_time"),
    supabase
      .from("wp_employees")
      .select("description_service, centre_cout")
      .or("description_service.not.is.null,centre_cout.not.is.null"),
    supabase
      .from("wp_employees")
      .select("vehicle_type, description_service, centre_cout, taux_occupation, date_sortie, est_sortie_temporaire"),
  ]);

  // Extract unique depots and cost centers
  const depots = [...new Set((employees || []).map((e) => e.description_service as string))].filter(Boolean).sort();
  const centres_cout = [...new Set((employees || []).map((e) => e.centre_cout as string))].filter(Boolean).sort();

  // Compute current headcounts for comparison
  const today = new Date().toISOString().split("T")[0];
  const active = (currentCounts || []).filter((e) => !e.date_sortie || e.date_sortie >= today);

  const currentByKey = new Map<string, { headcount: number; etp: number }>();

  active.forEach((e) => {
    const vt = e.vehicle_type || "AUTRE";
    const depot = e.description_service || "";
    const cc = e.centre_cout || "";
    const wt = String(Math.round(Number(e.taux_occupation) || 100));
    const key = `${vt}|${depot}|${cc}|${wt}`;
    const existing = currentByKey.get(key) || { headcount: 0, etp: 0 };
    existing.headcount++;
    existing.etp += Number(e.taux_occupation) / 100;
    currentByKey.set(key, existing);
  });

  // Build current counts array
  const currentCountsArray = [...currentByKey.entries()].map(([key, counts]) => {
    const [vehicle_type, depot, centre_cout, work_time] = key.split("|");
    return { vehicle_type, depot, centre_cout, work_time, ...counts };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Besoins cibles</h1>
        <p className="text-muted-foreground">
          Définissez les effectifs cibles par cost center, dépôt et taux d&apos;occupation.
        </p>
      </div>
      <TargetsClient
        initialTargets={(targets || []).map((t) => ({
          vehicle_type: t.vehicle_type || "",
          depot: t.depot || "",
          centre_cout: t.centre_cout || "",
          work_time: t.work_time,
          target_headcount: Number(t.target_headcount),
          target_etp: t.target_etp ? Number(t.target_etp) : null,
        }))}
        depots={depots}
        centres_cout={centres_cout}
        currentCounts={currentCountsArray}
      />
    </div>
  );
}
