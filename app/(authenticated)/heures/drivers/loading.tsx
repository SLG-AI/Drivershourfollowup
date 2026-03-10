import { Card, CardContent } from "@/components/ui/card";

export default function DriversLoading() {
  return (
    <div className="space-y-6">
      <div>
        <div className="h-8 w-40 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-4 w-64 animate-pulse rounded bg-muted" />
      </div>
      <div className="h-10 w-64 animate-pulse rounded bg-muted" />
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-3">
            {[...Array(10)].map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-muted" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
