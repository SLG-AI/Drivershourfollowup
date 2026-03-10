import { createClient } from "@/lib/supabase/server";
import { ScenarioListClient } from "./scenario-list-client";

export default async function ScenariosPage() {
  const supabase = await createClient();

  const { data: scenarios } = await supabase
    .from("wp_scenarios")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Scénarios</h1>
        <p className="text-muted-foreground">
          Créez et comparez des scénarios de projection des effectifs.
        </p>
      </div>
      <ScenarioListClient scenarios={scenarios || []} />
    </div>
  );
}
