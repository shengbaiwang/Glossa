import type { SVGProps } from 'react';

export type GlossaIconProps = SVGProps<SVGSVGElement> & { size?: number | string };

/** Quiet, rounded ink strokes shared by the library and reading controls. */
function Icon({ size = 24, className, children, ...props }: GlossaIconProps) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth={1.8}
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
      className={className ? `glossa-icon ${className}` : 'glossa-icon'}
      {...props}
    >
      {children}
    </svg>
  );
}

export function LibraryBig(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <path d='M5 5v14M10 5v14M15 5l4 14M4 19h7' />
    </Icon>
  );
}

export function BookOpen(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <path d='M12 6.5C9.5 4.8 6.5 4.5 3.5 5.5v13c3-1 6-.7 8.5 1 2.5-1.7 5.5-2 8.5-1v-13c-3-1-6-.7-8.5 1Zm0 0v13' />
    </Icon>
  );
}

export function PanelLeft(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <rect x='3.5' y='4.5' width='17' height='15' rx='3' />
      <path d='M9 4.5v15' />
    </Icon>
  );
}

export function Bookmark(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <path d='M6.5 20V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v14L12 16.5Z' />
    </Icon>
  );
}

export function NotebookPen(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <rect x='4.5' y='3.5' width='15' height='17' rx='3' />
      <path d='M8.5 8h7M10 12h4M8.5 16h7' />
    </Icon>
  );
}

export function MessageCircle(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <path d='M20 11.5a7.5 7.5 0 0 1-7.5 7.5H8l-4 2v-5a7.5 7.5 0 0 1 1-10.5A8.5 8.5 0 0 1 20 11.5Z' />
      <path d='M8 9h8M9.5 13h5' />
    </Icon>
  );
}
export function ArrowUp(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <path d='M12 19V5m-6 6 6-6 6 6' />
    </Icon>
  );
}
export function Square(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <rect x='6' y='6' width='12' height='12' rx='2' fill='currentColor' />
    </Icon>
  );
}

export function Type(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <path d='m3.5 18 5-13 5 13M5.4 13h6.2M20.5 18v-6a3 3 0 0 0-5-2.2M20.5 13h-3a2.5 2.5 0 0 0 0 5c1.4 0 2.5-.6 3-1.5' />
    </Icon>
  );
}

export function Search(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <circle cx='10.5' cy='10.5' r='6.5' />
      <path d='m15.3 15.3 4.7 4.7' />
    </Icon>
  );
}

export function Ellipsis(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <path d='M5 12h.01M12 12h.01M19 12h.01' strokeWidth='3' />
    </Icon>
  );
}

export function X(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <path d='m6.5 6.5 11 11m0-11-11 11' />
    </Icon>
  );
}

export function Pin(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <path d='M8 4h8M9 4v5l-3 4v1h12v-1l-3-4V4M12 14v6' />
    </Icon>
  );
}

export function PinOff(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <path d='M8 4h8M15 4v5l3 4M8 10l-2 3v1h8M12 14v6M4 4l16 16' />
    </Icon>
  );
}

export function ListTree(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <path d='M4.5 6h15M7 12h7M6 18h13.5' />
    </Icon>
  );
}

export function Highlight(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <path d='m7 14 9-9a2.1 2.1 0 0 1 3 3l-9 9H7v-3ZM14.5 6.5l3 3M4 20h16' />
    </Icon>
  );
}

export function ChevronLeft(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <path d='m14.5 6-6 6 6 6' />
    </Icon>
  );
}

export function ChevronRight(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <path d='m9.5 6 6 6-6 6' />
    </Icon>
  );
}

export function ChevronDown(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <path d='m6 9 6 6 6-6' />
    </Icon>
  );
}

export function ChevronsLeft(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <path d='m11 6-6 6 6 6m7-12-6 6 6 6' />
    </Icon>
  );
}

export function ChevronsRight(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <path d='m6 6 6 6-6 6m7-12 6 6-6 6' />
    </Icon>
  );
}

export function Undo2(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <path d='M5 10h9a5 5 0 0 1 0 10h-2M9 5l-5 5 5 5' />
    </Icon>
  );
}

export function Redo2(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <path d='M19 10h-9a5 5 0 0 0 0 10h2M15 5l5 5-5 5' />
    </Icon>
  );
}

export function RefreshCw(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <path d='M19 12a7 7 0 1 1-7-7c1.96 0 3.84.78 5.24 2.13L19 8.2' />
      <path d='M19 4.2v4h-4' />
    </Icon>
  );
}

export function Plus(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <path d='M5 12h14M12 5v14' />
    </Icon>
  );
}

export function Info(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <circle cx='12' cy='12' r='8' />
      <path d='M12 11v5M12 8h.01' />
    </Icon>
  );
}

export function Check(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <path d='m5 12 4.5 4.5L19 7' />
    </Icon>
  );
}

export function CheckCheck(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <path d='m3 12 4.5 4.5L17 7m-4 9.5L22 7' />
    </Icon>
  );
}

export function CheckSquare2(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <rect x='4' y='4' width='16' height='16' rx='3' />
      <path d='m8 12 3 3 5-6' />
    </Icon>
  );
}

export function SearchCheck(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <circle cx='10.5' cy='10.5' r='6.5' />
      <path d='m7.5 10.5 2 2 4-4m1.8 6.8 4.7 4.7' />
    </Icon>
  );
}

export function SlidersHorizontal(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <path d='M4 7h4m4 0h8M4 17h10m4 0h2' />
      <rect x='8' y='4' width='4' height='6' rx='2' />
      <rect x='14' y='14' width='4' height='6' rx='2' />
    </Icon>
  );
}

export function Sun(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <circle cx='12' cy='12' r='4' />
      <path d='M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5' />
    </Icon>
  );
}

export function Folder(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <path d='M3.5 7a2 2 0 0 1 2-2h4l2 3h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z' />
    </Icon>
  );
}

export function Users(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <circle cx='9.5' cy='8' r='3' />
      <path d='M3.5 19v-1a6 6 0 0 1 12 0v1M16 5.5a3 3 0 0 1 0 5.5m2 3a5 5 0 0 1 2.5 4.5v.5' />
    </Icon>
  );
}

export function Tags(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <path d='M4 5h7l9 9-7 7-9-9V5ZM8 9h.01' />
    </Icon>
  );
}

export function Layers(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <path d='m3.5 8 8.5-4 8.5 4-8.5 4ZM3.5 13l8.5 4 8.5-4m-17 5 8.5 4 8.5-4' />
    </Icon>
  );
}

export function Copy(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <rect x='8' y='8' width='12' height='12' rx='3' />
      <path d='M5 16a2 2 0 0 1-1-2V7a3 3 0 0 1 3-3h7a2 2 0 0 1 2 1' />
    </Icon>
  );
}

export function Link(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <path d='m10 7 2-2a5 5 0 0 1 7 7l-2 2M7 10l-2 2a5 5 0 0 0 7 7l2-2M9 15l6-6' />
    </Icon>
  );
}

export function Trash2(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <path d='M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l.8 11a2 2 0 0 0 2 2h6.4a2 2 0 0 0 2-2L18 7M10 11v5m4-5v5' />
    </Icon>
  );
}

export function Pencil(props: GlossaIconProps) {
  return (
    <Icon {...props}>
      <path d='m5 15 11-11a2.1 2.1 0 0 1 3 3L8 18l-4 1ZM14 6l3 3' />
    </Icon>
  );
}

export {
  LibraryBig as Library,
  PanelLeft as Sidebar,
  NotebookPen as Notebook,
  Type as Typography,
  Ellipsis as More,
  X as Close,
  ListTree as Contents,
  ListTree as List,
};
