import { useEffect, useRef } from 'react';
import { C } from '../theme';

interface Props {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
}

/** Freehand sketch pad (no recognition). Uses native, non-passive touch/mouse
 *  listeners so drawing is immediate and the iOS long-press callout / context
 *  menu / scrolling are fully suppressed (React's passive listeners can't do
 *  this, and Pointer Events are laggy for pen input on iPadOS). */
export function DrawingPad({ value, onChange }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  // keep the latest onChange without re-running the setup effect
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

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

    let drawing = false;
    let last: { x: number; y: number } | null = null;
    let activeId: number | null = null;

    const pt = (clientX: number, clientY: number) => {
      const r = c.getBoundingClientRect();
      return { x: (clientX - r.left) * (c.width / r.width), y: (clientY - r.top) * (c.height / r.height) };
    };
    const begin = (clientX: number, clientY: number) => {
      drawing = true;
      last = pt(clientX, clientY);
      // a dot so a single tap leaves a mark
      ctx.beginPath();
      ctx.arc(last.x, last.y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fillStyle = '#0E1721';
      ctx.fill();
    };
    const extend = (clientX: number, clientY: number) => {
      if (!drawing || !last) return;
      const p = pt(clientX, clientY);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
    };
    const finish = () => {
      if (!drawing) return;
      drawing = false;
      last = null;
      activeId = null;
      onChangeRef.current(c.toDataURL('image/png'));
    };

    const findTouch = (list: TouchList) => {
      for (let i = 0; i < list.length; i++) if (list[i].identifier === activeId) return list[i];
      return undefined;
    };
    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      if (drawing) return;
      const t = e.changedTouches[0];
      activeId = t.identifier;
      begin(t.clientX, t.clientY);
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const t = findTouch(e.changedTouches);
      if (t) extend(t.clientX, t.clientY);
    };
    const onTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      if (findTouch(e.changedTouches)) finish();
    };

    const onMouseDown = (e: MouseEvent) => begin(e.clientX, e.clientY);
    const onMouseMove = (e: MouseEvent) => extend(e.clientX, e.clientY);
    const onMouseUp = () => finish();

    const blockCtx = (e: Event) => e.preventDefault();

    c.addEventListener('touchstart', onTouchStart, { passive: false });
    c.addEventListener('touchmove', onTouchMove, { passive: false });
    c.addEventListener('touchend', onTouchEnd, { passive: false });
    c.addEventListener('touchcancel', onTouchEnd, { passive: false });
    c.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    c.addEventListener('contextmenu', blockCtx);
    document.addEventListener('contextmenu', blockCtx, { passive: false });

    return () => {
      c.removeEventListener('touchstart', onTouchStart);
      c.removeEventListener('touchmove', onTouchMove);
      c.removeEventListener('touchend', onTouchEnd);
      c.removeEventListener('touchcancel', onTouchEnd);
      c.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      c.removeEventListener('contextmenu', blockCtx);
      document.removeEventListener('contextmenu', blockCtx);
    };
    // set up once on mount (value used only for the initial paint)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clear() {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, c.width, c.height);
    onChangeRef.current(null);
  }

  return (
    <div>
      <canvas
        ref={ref}
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
