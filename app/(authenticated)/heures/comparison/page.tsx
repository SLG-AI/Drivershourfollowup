import { Suspense } from "react";
import ComparisonClient from "./comparison-client";

export default function ComparisonPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-muted-foreground">Chargement...</div>}>
      <ComparisonClient />
    </Suspense>
  );
}
