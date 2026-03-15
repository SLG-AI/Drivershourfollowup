import { createClient } from "@/lib/supabase/server";
import { TargetScenarioListClient } from "./target-scenario-list-client";

export default async function TargetsPage() {
  const supabase = await createClient();

  const { data: scenarios } = await supabase
    .from("wp_target_scenarios")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Besoins cibles</h1>
        <p className="text-muted-foreground">
          Créez des scénarios de besoins cibles par dépôt et par mois.
        </p>
      </div>
      <TargetScenarioListClient
        scenarios={(scenarios || []).map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description || null,
          created_at: s.created_at,
        }))}
      />
    </div>
  );
}
