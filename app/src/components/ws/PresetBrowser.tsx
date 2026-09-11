import { useMemo, useState } from "react";
import { useFocusTrap } from "../../hooks/use-focus-trap";

export interface VisualChoice { id: string; name: string }
interface Props {
  choices: VisualChoice[];
  current: string;
  favorites: string[];
  shuffleFavorites: boolean;
  onFavorite: (id: string) => void;
  onShuffleFavorites: (enabled: boolean) => void;
  onPlay: (id: string) => void;
  onCue?: (id: string) => void;
  onClose: () => void;
}
const btn = "border border-white/25 px-3 py-2 text-xs text-white/85 hover:border-white/70 disabled:opacity-40";
export function PresetBrowser(props: Props) {
  const ref = useFocusTrap<HTMLDivElement>(true);
  const [query, setQuery] = useState("");
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [selected, setSelected] = useState(props.current);
  const results = useMemo(() => props.choices.filter((v) =>
    v.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) &&
    (!onlyFavorites || props.favorites.includes(v.id))), [props.choices, props.favorites, query, onlyFavorites]);
  const choice = results.find((v) => v.id === selected);
  return <div ref={ref} role="dialog" aria-modal="true" aria-label="Visual browser" tabIndex={-1}
    className="absolute inset-0 z-20 flex items-center justify-center bg-scope/70 p-4 font-meter"
    onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") props.onClose(); }}>
    <div className="flex max-h-[85dvh] w-full max-w-2xl flex-col border border-white/20 bg-scope p-5">
      <div className="flex items-center justify-between"><h2>Browse visuals</h2><button className={btn} onClick={props.onClose}>close</button></div>
      <label className="mt-4 text-xs text-white/70">Search this engine
        <input value={query} onChange={(e) => setQuery(e.target.value)} autoFocus
          className="mt-2 w-full border border-white/25 bg-scope p-2 text-white" />
      </label>
      <div className="my-3 flex flex-wrap gap-4 text-xs text-white/70">
        <label><input type="checkbox" checked={onlyFavorites} onChange={(e) => setOnlyFavorites(e.target.checked)} /> Favorites only</label>
        <label><input type="checkbox" checked={props.shuffleFavorites} onChange={(e) => props.onShuffleFavorites(e.target.checked)} /> Shuffle favorites only</label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto border border-white/15">
        {results.length ? results.map((v) => <button key={v.id} aria-pressed={selected === v.id}
          className={`block w-full border-b border-white/10 px-3 py-2 text-left text-xs ${selected === v.id ? "bg-ultra/30 text-white" : "text-white/65 hover:bg-white/10"}`}
          onClick={() => setSelected(v.id)} onDoubleClick={() => props.onPlay(v.id)}>
          {props.favorites.includes(v.id) ? "★ " : ""}{v.name}{props.current === v.id ? " — playing" : ""}
        </button>) : <p className="p-5 text-sm text-white/60">No matching visuals.</p>}
      </div>
      <p className="mt-3 truncate text-xs text-white/60">{choice?.name ?? "Select a result. Browsing does not change the playing visual."}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className={btn} disabled={!choice} onClick={() => choice && props.onPlay(choice.id)}>Play selected</button>
        {props.onCue ? <button className={btn} disabled={!choice} onClick={() => choice && props.onCue?.(choice.id)}>Set morph target</button> : null}
        <button className={btn} disabled={!choice} onClick={() => choice && props.onFavorite(choice.id)}>
          {choice && props.favorites.includes(choice.id) ? "Remove favorite" : "Add favorite"}
        </button>
      </div>
      {props.shuffleFavorites ? <p className="mt-3 text-xs text-white/50">Automatic selection uses favorites in each engine. An empty pool holds the current visual.</p> : null}
    </div>
  </div>;
}
