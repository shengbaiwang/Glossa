import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useDrag } from '@/hooks/useDrag';

const STORAGE_KEY = 'glossaApplicationSettingsWindowGeometry';
const VIEWPORT_MARGIN = 16;
const MIN_WIDTH = 640;
const MIN_HEIGHT = 420;
const resizeDirections = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;
const managedStyleProperties = [
  'inset',
  'left',
  'top',
  'right',
  'bottom',
  'width',
  'height',
  'margin',
  'transform',
] as const;

type ResizeDirection = (typeof resizeDirections)[number];
type InteractionDirection = ResizeDirection | 'move';
type Geometry = { x: number; y: number; width: number; height: number };
type StyleSnapshot = Record<(typeof managedStyleProperties)[number], string>;
type Interaction = {
  direction: InteractionDirection;
  startX: number;
  startY: number;
  geometry: Geometry;
};

const isDesktopViewport = () => window.innerWidth >= 800 && window.innerHeight >= 640;
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const constrainGeometry = (candidate: Geometry): Geometry => {
  const maxWidth = Math.max(0, window.innerWidth - VIEWPORT_MARGIN * 2);
  const maxHeight = Math.max(0, window.innerHeight - VIEWPORT_MARGIN * 2);
  const minWidth = Math.min(MIN_WIDTH, maxWidth);
  const minHeight = Math.min(MIN_HEIGHT, maxHeight);
  const width = Math.min(Math.max(candidate.width, minWidth), maxWidth);
  const height = Math.min(Math.max(candidate.height, minHeight), maxHeight);
  const maxX = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
  const maxY = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
  return {
    x: Math.min(Math.max(candidate.x, VIEWPORT_MARGIN), maxX),
    y: Math.min(Math.max(candidate.y, VIEWPORT_MARGIN), maxY),
    width,
    height,
  };
};

const geometryFromRect = (rect: DOMRect): Geometry => ({
  x: rect.left,
  y: rect.top,
  width: rect.width,
  height: rect.height,
});

const readStoredGeometry = (): Geometry | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Record<string, unknown>;
    if (
      !isFiniteNumber(candidate['x']) ||
      !isFiniteNumber(candidate['y']) ||
      !isFiniteNumber(candidate['width']) ||
      !isFiniteNumber(candidate['height']) ||
      candidate['width'] <= 0 ||
      candidate['height'] <= 0
    ) {
      return null;
    }
    return constrainGeometry({
      x: candidate['x'],
      y: candidate['y'],
      width: candidate['width'],
      height: candidate['height'],
    });
  } catch {
    return null;
  }
};

const saveGeometry = (geometry: Geometry) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(geometry));
  } catch {
    return;
  }
};

const captureStyles = (box: HTMLDivElement): StyleSnapshot =>
  Object.fromEntries(
    managedStyleProperties.map((property) => [property, box.style[property]]),
  ) as StyleSnapshot;

const restoreStyles = (box: HTMLDivElement, snapshot: StyleSnapshot) => {
  for (const property of managedStyleProperties) box.style[property] = snapshot[property];
};

const resizeGeometry = (
  start: Geometry,
  direction: ResizeDirection,
  deltaX: number,
  deltaY: number,
): Geometry => {
  const maxWidth = Math.max(0, window.innerWidth - VIEWPORT_MARGIN * 2);
  const maxHeight = Math.max(0, window.innerHeight - VIEWPORT_MARGIN * 2);
  const minWidth = Math.min(MIN_WIDTH, maxWidth);
  const minHeight = Math.min(MIN_HEIGHT, maxHeight);
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (direction.includes('w')) left += deltaX;
  if (direction.includes('e')) right += deltaX;
  if (direction.includes('n')) top += deltaY;
  if (direction.includes('s')) bottom += deltaY;
  if (direction.includes('w')) {
    left = Math.min(left, right - minWidth);
    left = Math.max(left, VIEWPORT_MARGIN, right - maxWidth);
  }
  if (direction.includes('e')) {
    right = Math.max(right, left + minWidth);
    right = Math.min(right, window.innerWidth - VIEWPORT_MARGIN, left + maxWidth);
  }
  if (direction.includes('n')) {
    top = Math.min(top, bottom - minHeight);
    top = Math.max(top, VIEWPORT_MARGIN, bottom - maxHeight);
  }
  if (direction.includes('s')) {
    bottom = Math.max(bottom, top + minHeight);
    bottom = Math.min(bottom, window.innerHeight - VIEWPORT_MARGIN, top + maxHeight);
  }
  return constrainGeometry({ x: left, y: top, width: right - left, height: bottom - top });
};

const ignoreDragKeyDown = () => {};

export const useSettingsWindowGeometry = (enabled: boolean) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const geometryRef = useRef<Geometry | null>(null);
  const interactionRef = useRef<Interaction | null>(null);

  const applyGeometry = useCallback((candidate: Geometry) => {
    const box = boxRef.current;
    if (!box) return candidate;
    const geometry = constrainGeometry(candidate);
    geometryRef.current = geometry;
    box.style.inset = 'auto';
    box.style.left = `${geometry.x}px`;
    box.style.top = `${geometry.y}px`;
    box.style.width = `${geometry.width}px`;
    box.style.height = `${geometry.height}px`;
    box.style.margin = '0';
    box.style.transform = 'none';
    return geometry;
  }, []);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const snapshot = captureStyles(box);
    const syncGeometry = () => {
      interactionRef.current = null;
      if (!enabled || !isDesktopViewport()) {
        geometryRef.current = null;
        restoreStyles(box, snapshot);
        return;
      }
      const current =
        geometryRef.current ??
        readStoredGeometry() ??
        geometryFromRect(box.getBoundingClientRect());
      applyGeometry(current);
    };
    syncGeometry();
    window.addEventListener('resize', syncGeometry);
    return () => {
      window.removeEventListener('resize', syncGeometry);
      interactionRef.current = null;
      geometryRef.current = null;
      restoreStyles(box, snapshot);
    };
  }, [applyGeometry, enabled]);

  const beginInteraction = useCallback(
    (direction: InteractionDirection, event: ReactMouseEvent) => {
      if (!enabled || !isDesktopViewport() || event.button !== 0 || !boxRef.current) return false;
      if (
        direction === 'move' &&
        event.target instanceof Element &&
        event.target.closest('button, input, select, textarea, a, [role="button"]')
      ) {
        return false;
      }
      const geometry = applyGeometry(geometryFromRect(boxRef.current.getBoundingClientRect()));
      interactionRef.current = {
        direction,
        startX: event.clientX,
        startY: event.clientY,
        geometry,
      };
      return true;
    },
    [applyGeometry, enabled],
  );

  const moveInteraction = useCallback(
    ({ clientX, clientY }: { clientX: number; clientY: number }) => {
      const interaction = interactionRef.current;
      if (!interaction || !enabled || !isDesktopViewport()) return;
      const deltaX = clientX - interaction.startX;
      const deltaY = clientY - interaction.startY;
      if (interaction.direction === 'move') {
        applyGeometry({
          ...interaction.geometry,
          x: interaction.geometry.x + deltaX,
          y: interaction.geometry.y + deltaY,
        });
      } else {
        applyGeometry(resizeGeometry(interaction.geometry, interaction.direction, deltaX, deltaY));
      }
    },
    [applyGeometry, enabled],
  );

  const finishInteraction = useCallback(() => {
    interactionRef.current = null;
    if (enabled && isDesktopViewport() && geometryRef.current) {
      saveGeometry(geometryRef.current);
    }
  }, [enabled]);

  const { handleDragStart } = useDrag(
    moveInteraction,
    ignoreDragKeyDown,
    finishInteraction,
    'move',
  );
  const handleMoveStart = useCallback(
    (event: ReactMouseEvent) => {
      if (beginInteraction('move', event)) handleDragStart(event);
    },
    [beginInteraction, handleDragStart],
  );

  return {
    boxRef,
    enabled,
    beginInteraction,
    moveInteraction,
    finishInteraction,
    handleMoveStart,
  };
};

type GeometryController = ReturnType<typeof useSettingsWindowGeometry>;

const SettingsWindowResizeHandle = ({
  direction,
  controller,
}: {
  direction: ResizeDirection;
  controller: GeometryController;
}) => {
  const { handleDragStart } = useDrag(
    controller.moveInteraction,
    ignoreDragKeyDown,
    controller.finishInteraction,
    `${direction}-resize`,
  );
  return (
    <div
      aria-hidden='true'
      data-resize-direction={direction}
      className={`glossa-settings-resize-handle glossa-settings-resize-${direction}`}
      onMouseDown={(event) => {
        if (controller.beginInteraction(direction, event)) handleDragStart(event);
      }}
    >
      {direction === 'se' && <span className='glossa-settings-resize-grip' />}
    </div>
  );
};

export const SettingsWindowResizeHandles = ({ controller }: { controller: GeometryController }) => {
  if (!controller.enabled) return null;
  return (
    <>
      {resizeDirections.map((direction) => (
        <SettingsWindowResizeHandle key={direction} direction={direction} controller={controller} />
      ))}
    </>
  );
};
