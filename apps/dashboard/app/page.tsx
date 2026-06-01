"use client";

import { useState } from "react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ConfigGate } from "@/components/ConfigGate";
import { RealtimeBoot } from "@/components/RealtimeBoot";
import { BalanceChart } from "@/components/panels/BalanceChart";
import { Controls } from "@/components/panels/Controls";
import { Positions } from "@/components/panels/Positions";
import { ReasoningLog } from "@/components/panels/ReasoningLog";
import { Screening } from "@/components/panels/Screening";
import { SmartWalletFeed } from "@/components/panels/SmartWalletFeed";
import { Learning } from "@/components/panels/Learning";

export default function DashboardPage() {
  const [configOpen, setConfigOpen] = useState(false);
  const [configUnlocked, setConfigUnlocked] = useState(false);

  const onConfigToggle = () => {
    if (configUnlocked) {
      setConfigOpen((prev) => !prev);
    } else {
      setConfigOpen(true);
    }
  };

  const onUnlock = () => {
    setConfigUnlocked(true);
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <RealtimeBoot />
      <Header />

      <main className="flex-1 p-2">
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-12">
          <div className="lg:col-span-7 h-[300px] sm:h-[380px]">
            <BalanceChart />
          </div>
          <div className="lg:col-span-5 lg:row-span-2 h-[400px] sm:h-[708px] scanlines">
            <ReasoningLog />
          </div>
          <div className="lg:col-span-7 h-[280px] sm:h-[320px]">
            <Positions />
          </div>
          <div className="lg:col-span-7 h-[280px] sm:h-[320px]">
            <Screening />
          </div>
          <div className="lg:col-span-5 h-[280px] sm:h-[320px]">
            <SmartWalletFeed />
          </div>
          <div className="lg:col-span-12 h-[280px] sm:h-[320px]">
            <Learning />
          </div>
          {configOpen && configUnlocked && (
            <div className="lg:col-span-12">
              <Controls />
            </div>
          )}
        </div>
      </main>

      <Footer onConfigToggle={onConfigToggle} />

      <ConfigGate
        open={configOpen && !configUnlocked}
        onUnlock={onUnlock}
        onClose={() => setConfigOpen(false)}
      />
    </div>
  );
}
