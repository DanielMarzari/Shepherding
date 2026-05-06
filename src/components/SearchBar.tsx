"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { searchPeopleAction, type SearchResults } from "@/app/actions/search";
import type { SearchHit } from "@/lib/people-read";

export function SearchBar() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setHits([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const id = ++requestIdRef.current;
      const result: SearchResults = await searchPeopleAction(query);
      // Discard out-of-order responses.
      if (id !== requestIdRef.current) return;
      setHits(result.hits);
      setHighlight(0);
      setOpen(true);
      setLoading(false);
    }, 180);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function go(pcoId: string) {
    setOpen(false);
    setQuery("");
    setHits([]);
    router.push(`/people/${pcoId}`);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (hits.length > 0) {
        setOpen(true);
        setHighlight((h) => (h + 1) % hits.length);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (hits.length > 0) {
        setOpen(true);
        setHighlight((h) => (h - 1 + hits.length) % hits.length);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (hits[highlight]) go(hits[highlight].pcoId);
    }
  }

  return (
    <div ref={wrapRef} className="relative hidden lg:block w-72">
      <div className="relative">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => hits.length > 0 && setOpen(true)}
          onKeyDown={onKey}
          placeholder="Search people…  ⌘K"
          className="w-full bg-transparent border border-border-soft rounded pl-8 pr-3 py-1.5 text-sm placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
          autoComplete="off"
          spellCheck={false}
        />
        {loading && (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-subtle">
            …
          </span>
        )}
      </div>

      {open && (
        <div className="absolute left-0 right-0 mt-1 bg-bg-elev border border-border-soft rounded-lg shadow-lg overflow-hidden z-50">
          {hits.length === 0 ? (
            <div className="px-4 py-3 text-sm text-muted">
              {query.trim().length < 2
                ? "Type 2+ characters to search."
                : `No people match "${query}".`}
            </div>
          ) : (
            <ul>
              {hits.map((hit, i) => (
                <li key={hit.pcoId}>
                  <button
                    type="button"
                    onClick={() => go(hit.pcoId)}
                    onMouseEnter={() => setHighlight(i)}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center gap-3 transition-colors ${
                      i === highlight ? "bg-bg-elev-2" : ""
                    }`}
                  >
                    <span className="w-7 h-7 rounded-full bg-bg-elev-2 grid place-items-center text-xs font-medium shrink-0">
                      {hit.initials}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-medium truncate">{hit.fullName}</span>
                      <span className="block text-xs text-muted truncate">
                        PCO #{hit.pcoId}
                        {hit.membershipType ? ` · ${hit.membershipType}` : ""}
                      </span>
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        hit.classification === "active"
                          ? "bg-good-soft-bg text-good-soft-fg"
                          : hit.classification === "present"
                            ? "bg-accent-soft-bg text-accent-soft-fg"
                            : hit.classification === "shepherded"
                              ? "bg-accent-soft-bg text-accent-soft-fg"
                              : "bg-warn-soft-bg text-warn-soft-fg"
                      }`}
                    >
                      {hit.classification}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
