import { Header } from "@/components/Header";
import { RealtimeBoot } from "@/components/RealtimeBoot";
import { BalanceChart } from "@/components/panels/BalanceChart";
import { Controls } from "@/components/panels/Controls";
import { Positions } from "@/components/panels/Positions";
import { ReasoningLog } from "@/components/panels/ReasoningLog";
import { Screening } from "@/components/panels/Screening";
import { SmartWalletFeed } from "@/components/panels/SmartWalletFeed";

/**
 * Dashboard shell — brutalist 12-column grid.
 *
 *   ROW 1: [ BalanceChart · 7 ]  [ ReasoningLog · 5, spans 2 rows ]
 *   ROW 2: [ Positions   · 7 ]
 *   ROW 3: [ Screening   · 7 ]  [ SmartWalletFeed · 5 ]
 *   ROW 4: [ Controls · 12 ]
 */
export default function DashboardPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <RealtimeBoot />
      <Header />

      <main className="flex-1 p-2">
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-12">
          <div className="lg:col-span-7 h-[380px]">
            <BalanceChart />
          </div>
          <div className="lg:col-span-5 lg:row-span-2 h-[720px] lg:h-[708px] scanlines">
            <ReasoningLog />
          </div>
          <div className="lg:col-span-7 h-[320px]">
            <Positions />
          </div>
          <div className="lg:col-span-7 h-[320px]">
            <Screening />
          </div>
          <div className="lg:col-span-5 h-[320px]">
            <SmartWalletFeed />
          </div>
          <div className="lg:col-span-12">
            <Controls />
          </div>
        </div>
      </main>
    </div>
  );
}
