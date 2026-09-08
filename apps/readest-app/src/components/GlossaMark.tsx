import type { SVGProps } from 'react';

/** The interlinear mark from the app icon, using the current interface ink. */
export default function GlossaMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox='160 400 940 440' fill='currentColor' aria-hidden='true' {...props}>
      <rect x='219' y='466' width='777' height='48' rx='24' />
      <rect x='315' y='608' width='324' height='48' rx='24' />
      <rect x='291' y='750' width='745' height='48' rx='24' />
    </svg>
  );
}
