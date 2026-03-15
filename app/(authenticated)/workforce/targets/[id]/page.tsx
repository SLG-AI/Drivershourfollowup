import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { notFound } from "next/navigation";
import { TargetScenarioEditorClient } from "./target-scenario-editor-client";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function TargetScenarioEditorPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: scenario }, { data: values }, employees, { data: projectionScenarios }] = await Promise.all([
    supabase.from("wp_target_scenarios").select("*").eq("id", id).single(),
    supabase.from("wp_target_scenario_values").select("*").eq("scenario_id", id),
    fetchAll(
      supabase.from("wp_employees").select("description_service, centre_cout, date_sortie, date_entree, taux_occupation, est_sortie_temporaire")
    ),
    supabase.from("wp_scenarios").select("id, name").order("name"),
  ]);

  if (!scenario) notFound();

  // Build cost center → depots mapping from active employees
  const today = new Date().toISOString().split("T")[0];
  const active = employees.filter((e) => !e.date_sortie || e.date_sortie >= today);

  const ccDepotsMap = new Map<string, Set<string>>();
  active.forEach((e) => {
    const cc = e.centre_cout || "Autre";
    const depot = e.description_service || "Non assigné";
    if (!ccDepotsMap.has(cc)) ccDepotsMap.set(cc, new Set());
    ccDepotsMap.get(cc)!.add(depot);
  });

  const costCenters = Array.from(ccDepotsMap.entries())
    .map(([cc, depots]) => ({
      name: cc,
      depots: Array.from(depots).sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-6">
      <TargetScenarioEditorClient
        scenario={{ id: scenario.id, name: scenario.name, description: scenario.description || "" }}
        values={(values || []).map((v) => ({
          mois: Number(v.mois),
          depot: v.depot as string,
          target_etp: Number(v.target_etp),
        }))}
        costCenters={costCenters}
        projectionScenarios={(projectionScenarios || []).map((s) => ({ id: s.id, name: s.name }))}
      />
    </div>
  );
}
