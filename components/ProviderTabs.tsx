"use client";

import { useState } from "react";

interface Provider {
  id: string;
  name: string;
  url: string;
  color: string;
}

interface ProviderTabsProps {
  providers: Provider[];
  activeId: string;
  onSelect: (id: string) => void;
}

export default function ProviderTabs({ providers, activeId, onSelect }: ProviderTabsProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const activeProvider = providers.find((p) => p.id === activeId);

  return (
    <>
      {/* Desktop tabs */}
      <div className="hidden sm:flex gap-1 px-4">
        {providers.map((provider) => {
          const isActive = provider.id === activeId;
          return (
            <button
              key={provider.id}
              onClick={() => onSelect(provider.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-700/50"
              }`}
            >
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: provider.color }}
              />
              {provider.name}
            </button>
          );
        })}
      </div>

      {/* Mobile dropdown */}
      <div className="sm:hidden px-4 relative">
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="flex items-center justify-between w-full px-4 py-2 bg-gray-700 rounded-lg text-sm font-medium text-white"
        >
          <span className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: activeProvider?.color }}
            />
            {activeProvider?.name}
          </span>
          <svg
            className={`w-4 h-4 transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {dropdownOpen && (
          <div className="absolute top-full left-4 right-4 mt-1 bg-gray-700 rounded-lg shadow-lg z-50 overflow-hidden">
            {providers.map((provider) => (
              <button
                key={provider.id}
                onClick={() => {
                  onSelect(provider.id);
                  setDropdownOpen(false);
                }}
                className={`flex items-center gap-2 w-full px-4 py-3 text-sm text-left transition-colors ${
                  provider.id === activeId
                    ? "bg-gray-600 text-white"
                    : "text-gray-300 hover:bg-gray-600"
                }`}
              >
                <span
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: provider.color }}
                />
                {provider.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
