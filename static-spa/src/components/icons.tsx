/**
 * Local icon set — replaces lucide-react.
 *
 * Every glyph is drawn on the same 24x24 grid with a 1.75 stroke, so existing
 * `h-4 w-4` / `h-3.5 w-3.5` sizing keeps working unchanged. Export names match
 * the lucide names they replaced, so swapping is a one-line import change.
 *
 * Stroke weight is a touch lighter than lucide's default 2 to sit better
 * beside IBM Plex at 13px.
 */
import { SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/* ---------- navigation ---------- */

export const Home = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 10.4 12 3l9 7.4" />
    <path d="M5.5 9.3V19a1.5 1.5 0 0 0 1.5 1.5h3v-6h4v6h3A1.5 1.5 0 0 0 18.5 19V9.3" />
  </Svg>
);

export const Menu = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h17" />
  </Svg>
);

export const ChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 9.5 6 6 6-6" />
  </Svg>
);

export const ChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="m9.5 6 6 6-6 6" />
  </Svg>
);

export const X = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);

/* ---------- auth ---------- */

export const LogIn = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
    <path d="m10 17 5-5-5-5" />
    <path d="M15 12H3" />
  </Svg>
);

export const LogOut = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </Svg>
);

export const UserPlus = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="7.5" r="3.75" />
    <path d="M2.5 20.5v-1.75A4.25 4.25 0 0 1 6.75 14.5h4.5a4.25 4.25 0 0 1 4.25 4.25v1.75" />
    <path d="M19 8.5v5M21.5 11h-5" />
  </Svg>
);

export const Users = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="7.5" r="3.75" />
    <path d="M2.5 20.5v-1.75A4.25 4.25 0 0 1 6.75 14.5h4.5a4.25 4.25 0 0 1 4.25 4.25v1.75" />
    <path d="M16.5 3.9a3.75 3.75 0 0 1 0 7.2" />
    <path d="M21.5 20.5v-1.75a4.25 4.25 0 0 0-3-4.06" />
  </Svg>
);

/* ---------- keys & data ---------- */

export const KeyRound = (p: IconProps) => (
  <Svg {...p}>
    <path d="M16.5 2.5a5.5 5.5 0 0 0-5.2 7.3L2.8 18.3a1 1 0 0 0-.3.7v2a1 1 0 0 0 1 1h2a1 1 0 0 0 .7-.3l.8-.8v-1.7h1.7l1.5-1.5v-1.7h1.7l1.3-1.3a5.5 5.5 0 1 0 3.3-9.8Z" />
    <circle cx="17" cy="7" r="1.15" />
  </Svg>
);

export const Database = (p: IconProps) => (
  <Svg {...p}>
    <ellipse cx="12" cy="5.5" rx="8" ry="3" />
    <path d="M4 5.5v13c0 1.66 3.58 3 8 3s8-1.34 8-3v-13" />
    <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
  </Svg>
);

export const Copy = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="9" width="12.5" height="12.5" rx="2" />
    <path d="M5.5 15H4.5a2 2 0 0 1-2-2V4.5a2 2 0 0 1 2-2H13a2 2 0 0 1 2 2v1" />
  </Svg>
);

export const Trash2 = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 6h17" />
    <path d="M8.5 6V4.5a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 1 1.5 1.5V6" />
    <path d="M18.5 6l-.8 13.1a2 2 0 0 1-2 1.9H8.3a2 2 0 0 1-2-1.9L5.5 6" />
    <path d="M10 10.5v6M14 10.5v6" />
  </Svg>
);

export const Plus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4.5v15M4.5 12h15" />
  </Svg>
);

/* ---------- status ---------- */

export const Check = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4.5 12.5 5 5 10-11" />
  </Svg>
);

export const Circle = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9.25" />
  </Svg>
);

export const AlertCircle = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9.25" />
    <path d="M12 7.5v5" />
    <path d="M12 16.2h.01" />
  </Svg>
);

export const Ban = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9.25" />
    <path d="m5.5 5.5 13 13" />
  </Svg>
);

export const Shield = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21.5s7.5-3.6 7.5-9.4V5.4L12 2.5 4.5 5.4v6.7c0 5.8 7.5 9.4 7.5 9.4Z" />
  </Svg>
);

export const ShieldCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21.5s7.5-3.6 7.5-9.4V5.4L12 2.5 4.5 5.4v6.7c0 5.8 7.5 9.4 7.5 9.4Z" />
    <path d="m9 11.8 2.1 2.1 4-4.2" />
  </Svg>
);

/* ---------- metrics ---------- */

export const Activity = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21.5 12H17l-3 8.5-4-17-3 8.5H2.5" />
  </Svg>
);

export const TrendingUp = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21.5 7 13.5 15.5l-4.5-4.5L2.5 17.5" />
    <path d="M15.5 7h6v6" />
  </Svg>
);

/* ---------- motion / theme ---------- */

export const RefreshCw = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20.5 12a8.5 8.5 0 0 1-14.6 5.9L2.5 15" />
    <path d="M3.5 12a8.5 8.5 0 0 1 14.6-5.9l3.4 2.9" />
    <path d="M21.5 3.5V9h-5.5" />
    <path d="M2.5 20.5V15H8" />
  </Svg>
);

/** Spinner arc — pair with `className="animate-spin"`. */
export const Loader2 = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 12a9 9 0 1 1-6.22-8.56" />
  </Svg>
);

export const Sun = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2.2M12 19.3v2.2M4.8 4.8l1.6 1.6M17.6 17.6l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.8 19.2l1.6-1.6M17.6 6.4l1.6-1.6" />
  </Svg>
);

export const Moon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20.5 13.3A8.5 8.5 0 1 1 10.7 3.5a6.6 6.6 0 0 0 9.8 9.8Z" />
  </Svg>
);

/* ---------- model modalities ---------- */

export const Type = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6.5V5h16v1.5M12 5v14M9 19h6" />
  </Svg>
);

export const ImageIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.5" />
    <path d="m3.5 16.5 4.5-4 4 3.5 3.5-3 5 4.5" />
  </Svg>
);

export const Video = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="6" width="13" height="12" rx="2" />
    <path d="m15.5 11 6-3.5v9l-6-3.5z" />
  </Svg>
);

export const Audio = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 10v4M8 7v10M12 4.5v15M16 8v8M20 10.5v3" />
  </Svg>
);

export const FileIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5z" />
    <path d="M14 3v4.5h4.5" />
  </Svg>
);

/** Reasoning / thinking capability. */
export const Sparkles = (p: IconProps) => (
  <Svg {...p}>
    <path d="m10 4 1.4 3.9L15.5 9.3l-4.1 1.4L10 14.6l-1.4-3.9L4.5 9.3l4.1-1.4z" />
    <path d="M17.5 14.5l.8 2.1 2.2.8-2.2.8-.8 2.1-.8-2.1-2.2-.8 2.2-.8z" />
  </Svg>
);

/** Tool / function calling capability. */
export const Wrench = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15.2 6.2a3.8 3.8 0 0 1 5.2 4.9l-2-2-2.4.6-.6-2.4z" />
    <path d="m14.4 8.4-9 9a2 2 0 0 0 2.8 2.8l9-9" />
  </Svg>
);

/** Structured-output / JSON-schema capability. */
export const Braces = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8.5 3.5c-2 0-2.5 1-2.5 2.5v2.5c0 1.5-.8 2.5-2 3.5 1.2 1 2 2 2 3.5V18c0 1.5.5 2.5 2.5 2.5" />
    <path d="M15.5 3.5c2 0 2.5 1 2.5 2.5v2.5c0 1.5.8 2.5 2 3.5-1.2 1-2 2-2 3.5V18c0 1.5-.5 2.5-2.5 2.5" />
  </Svg>
);

export const ArrowRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 12h15m0 0-5.5-5.5M19 12l-5.5 5.5" />
  </Svg>
);

/** Wordmark glyph used for the brand square and favicon. */
export const NousMark = (p: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    {...p}
  >
    <path
      d="M6 18V6l12 12V6"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
