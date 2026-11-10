import { Package as PackageIcon } from "lucide-react";
import { useState } from "react";
import type { Bootstrap, Package } from "../api";
import { PackageCard } from "../components/Feed";
import { Button, Card, Empty, SectionTitle } from "../components/ui";

const RANK: Record<string, number> = { exception: 0, out_for_delivery: 1, in_transit: 2, shipped: 3, ordered: 4, delivered: 5 };

export function PackagesPage({ data }: { data: Bootstrap }) {
  const [showHidden, setShowHidden] = useState(false);
  const sort = (a: Package, b: Package) => RANK[a.status] - RANK[b.status] || (a.eta ?? "9").localeCompare(b.eta ?? "9");
  const active = data.packages.filter((p) => !p.archived && p.status !== "delivered").sort(sort);
  const delivered = data.packages.filter((p) => !p.archived && p.status === "delivered").sort((a, b) => b.last_update.localeCompare(a.last_update));
  const hidden = data.packages.filter((p) => p.archived);

  const grid = (ps: Package[]) => (
    <div className="grid grid-cols-1 gap-2.5 @xl:grid-cols-2">
      {ps.map((p) => (
        <PackageCard key={p.key} p={p} />
      ))}
    </div>
  );

  return (
    <div className="@container mx-auto max-w-[960px] px-8 py-8">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight">Packages</h1>
          <p className="mt-1 text-[13.5px] text-fg-2">Tracked from order, shipping and delivery emails. Delivered packages hide themselves after 3 days.</p>
        </div>
        {hidden.length > 0 && (
          <Button variant="ghost" onClick={() => setShowHidden(!showHidden)}>
            {showHidden ? "Hide" : "Show"} hidden ({hidden.length})
          </Button>
        )}
      </header>

      {active.length + delivered.length === 0 && !showHidden ? (
        <Card>
          <Empty icon={<PackageIcon size={20} />} title="Nothing on the way">Shipping emails from any store or carrier show up here automatically.</Empty>
        </Card>
      ) : (
        <div className="space-y-8">
          {active.length > 0 && (
            <div>
              <SectionTitle>On the way · {active.length}</SectionTitle>
              {grid(active)}
            </div>
          )}
          {delivered.length > 0 && (
            <div>
              <SectionTitle>Delivered</SectionTitle>
              {grid(delivered)}
            </div>
          )}
          {showHidden && hidden.length > 0 && (
            <div>
              <SectionTitle>Hidden</SectionTitle>
              {grid(hidden)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
