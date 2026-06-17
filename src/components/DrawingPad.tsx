import { useEffect, useRef } from 'react';
import { C } from '../theme';

interface Props {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
}

/** Freehand sketch pad (no recognition). Exports the drawing as a PNG data URL. */
export function DrawingPad({ value, onChange }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  // Suppress the long-press context menu / selection callout (incl. iPad/iOS,
  // where CSS alone isn't enough) while the sketch pad is open. A native,
  // non-passive listener is required so preventDefault actually takes effect.
  useEffect(() => {
    const blockCtx = (e: Event) => e.preventDefault();
    document.addEventListener('contextmenu', blockCtx, { passive: false });
    return () => document.removeEventListener('contextmenu', blockCtx);
  }, []);

  // size the canvas to its rendered box (crisp on hi-dpi) and paint any existing sketch
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.round(rect.width * dpr));
    c.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.lineWidth = 2.5 * dpr;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0E1721';
    if (value) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height);
      img.src = value;
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pos(e: React.PointerEvent) {
    const c = ref.current!;
    const rect = c.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (c.width / rect.width),
      y: (e.clientY - rect.top) * (c.height / rect.height),
    };
  }
  function down(e: React.PointerEvent) {
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = pos(e);
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current) return;
    const ctx = ref.current!.getContext('2d')!;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.current!.x, last.current!.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  }
  function up() {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    onChange(ref.current!.toDataURL('image/png'));
  }
  function clear() {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, c.width, c.height);
    onChange(null);
  }

  return (
    <div>
      <canvas
        ref={ref}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          width: '100%',
          height: 160,
          border: '1px solid #D5DBDF',
          background: '#FFFFFF',
          touchAction: 'none',
          display: 'block',
          cursor: 'crosshair',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
        }}
      />
      <button
        type="button"
        onClick={clear}
        style={{ marginTop: 8, padding: '7px 12px', background: C.lt2, color: C.dk1, fontSize: 12, fontWeight: 700 }}
      >
        Zeichnung löschen
      </button>
    </div>
  );
}
