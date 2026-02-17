"use client";

import { useState } from "react";
import ProviderTabs from "@/components/ProviderTabs";
import IframePanel from "@/components/IframePanel";
import providers from "@/config/providers.json";

export default function Home() {
  const [activeId, setActiveId] = useState(providers[0].id);

  return (
    <div className="flex flex-col h-screen bg-gray-800">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 bg-gray-900">
        <h1 className="text-lg font-bold text-white tracking-tight">
          Lunch Hub
        </h1>
        <span className="text-xs text-gray-500">
          {providers.length} providers
        </span>
      </header>

      {/* Tabs */}
      <nav className="bg-gray-800 pt-2">
        <ProviderTabs
          providers={providers}
          activeId={activeId}
          onSelect={setActiveId}
        />
      </nav>

      {/* Iframe area */}
      <IframePanel providers={providers} activeId={activeId} />
    </div>
  );
}
