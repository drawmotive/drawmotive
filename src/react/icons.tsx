import type { CSSProperties } from 'react';

/** Small SVGs keep SDK controls independent of application icon fonts. */
export function Icon({ name, style }: { name: string; style?: CSSProperties }) {
  const paths: Record<string, string> = {
    undo: 'M8 5 3 10l5 5M3 10h10a7 7 0 0 1 0 14',
    redo: 'm16 5 5 5-5 5m5-5H11a7 7 0 0 0 0 14',
    arrow: 'M5 5 19 19M10 19h9v-9',
    rectangle: 'M4 5h16v14H4z', ellipse: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16',
    diamond: 'm12 3 9 9-9 9-9-9z', text: 'M5 5h14M12 5v15M8 20h8',
    select: 'm5 3 14 10-7 1-3 7z', sketchyMode: 'm5 6 9-3-7 9 13-7-10 14 9-3M4 20l5-6',
    zoomIn: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6M7 10h6m-3-3v6',
    zoomOut: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6M7 10h6',
    settings: 'm10 3-1 3-3 1-3 3v4l3 1 1 3 3 3h4l1-3 3-1 3-3v-4l-3-1-1-3-3-3zm2 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
    help: 'M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 4m0 4h.01M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20',
    strokeStyle: 'M3 6h18M3 12h5m3 0h5m3 0h2M3 18h1m4 0h1m4 0h1m4 0h1',
    cornerRadius: 'M4 20V10a6 6 0 0 1 6-6h10M4 4v1m0 3v1m4-5h1',
    editText: 'M4 4h16v16H4zM8 8h8m-4 0v9m-3 0h6',
    bold: 'M7 3h6a4.5 4.5 0 0 1 0 9H7m0-9v18h7a4.5 4.5 0 0 0 0-9H7',
    italic: 'M10 3h9M5 21h9M15 3 9 21',
    textAlign: 'M3 4h18M7 9h10M3 14h18M7 19h10',
    swapLineEndpoints: 'M3 7h18m-4-4 4 4-4 4M21 17H3m4-4-4 4 4 4',
    lineRouting: 'M3 20V5h18m-4-4 4 4-4 4',
    lineAttachment: 'M3 6h5v12H3zM16 6h5v12h-5zM8 12h8',
    groupTheme: 'M3 5h18v15H3zM3 10h18',
    groupTitleStyle: 'M3 4h18v16H3zM7 8h10M12 8v8',
    moreOptions: 'M12 4h.01M12 12h.01M12 20h.01',
    copy: 'M8 8h13v13H8zM16 8V3H3v13h5',
    delete: 'M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
    close: 'm5 5 14 14M5 19 19 5',
  };
  if (name.startsWith('textSize')) return <span style={style} aria-hidden="true">{name.endsWith('Small') ? 'S' : name.endsWith('Medium') ? 'M' : 'L'}</span>;
  if (name === 'strokeColor' || name === 'strokeFillColor') return <PaletteIcon style={style} />;
  if (name === 'lineStartStyle') return <EndpointIcon value={1} start />;
  if (name === 'lineEndStyle') return <EndpointIcon value={1} />;
  return <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth={name === 'moreOptions' ? 3.2 : 1.65} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name] ?? 'M4 4h16v16H4z'} /></svg>;
}

export function PaletteIcon({ fill = 'none', style }: { fill?: string; style?: CSSProperties }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill={fill} stroke="currentColor" strokeWidth="1.7" aria-hidden="true" style={style}>
    <path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-4c-1-1 0-3 2-3h2c4 0 4-5 0-8a11 11 0 0 0-6-3Z" />
    <circle cx="7" cy="10" r=".8" /><circle cx="10" cy="7" r=".8" /><circle cx="14" cy="7" r=".8" /><circle cx="17" cy="10" r=".8" />
  </svg>;
}

/** Same six endpoint styles as the engine, drawn in Y-down coordinates. */
export function EndpointIcon({ value, start = false }: { value: number; start?: boolean }) {
  return <svg viewBox="0 0 32 24" width="28" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <g transform={start ? 'translate(32 0) scale(-1 1)' : undefined}><path d="M2 12h23" />
      {value === 1 && <path d="m18 6 7 6-7 6" />}
      {value === 2 && <path fill="currentColor" d="m18 6 9 6-9 6z" />}
      {value === 3 && <path d="m27 12-10-6 4 6-4 6z" fill="currentColor" />}
      {value === 4 && <circle cx="24" cy="12" r="4" fill="var(--dm-surface, white)" />}
      {value === 5 && <path d="m23 7 6 5-6 5-6-5z" fill="var(--dm-surface, white)" />}
    </g>
  </svg>;
}
