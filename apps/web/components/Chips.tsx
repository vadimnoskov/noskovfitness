import type { WorkoutTags } from '@nf/core';
const LOAD = { bodyweight: 'l0', light: 'l1', medium: 'l2', heavy: 'l3' } as const;
const LOAD_LABEL = { bodyweight: 'bw', light: 'light', medium: 'med', heavy: 'heavy' } as const;
const VOL = { low: 'v1', medium: 'v2', high: 'v3' } as const;

export function Chips({ mods, load, minutes, volume, priority }: { mods: string[]; load: WorkoutTags['load']; minutes?: number; volume: WorkoutTags['volume']; priority: WorkoutTags['priority'] }) {
  return (
    <div className="hdr">
      {mods.map((m, i) => <i key={i} className={`chip ${m.toLowerCase()}`}>{m}</i>)}
      <i className={`chip ${LOAD[load]}`}>{LOAD_LABEL[load]}</i>
      {minutes ? <i className="chip">{minutes}′</i> : null}
      <i className={`chip ${VOL[volume]}`}>{volume === 'medium' ? 'med' : volume}</i>
      <i className={`chip ${priority}`}>{priority}</i>
    </div>
  );
}

export function Legend() {
  return (
    <div className="legend">
      <span><i className="chip w">W</i> weightlifting</span><span><i className="chip g">G</i> gymnastics</span><span><i className="chip m">M</i> monostructural</span>
      <span>load <i className="chip l0">bw</i><i className="chip l1">light</i><i className="chip l2">med</i><i className="chip l3">heavy</i></span>
      <span>volume <i className="chip v1">low</i><i className="chip v2">med</i><i className="chip v3">high</i></span>
      <span>priority <i className="chip task">task</i><i className="chip time">time</i></span>
      <span><b className="bm">★</b> benchmark</span>
    </div>
  );
}
