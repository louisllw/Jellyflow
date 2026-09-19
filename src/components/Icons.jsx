// Minimal line icons, drawn to a 24×24 grid — one visual voice for the whole app.

const S = (props) => ({
  width: props.size || 20,
  height: props.size || 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
});

export const IconHome = (p) => (
  <svg {...S(p)}>
    <path d="M4 10.5 12 4l8 6.5" />
    <path d="M6 9.5V19a1 1 0 0 0 1 1h3.5v-5h3v5H17a1 1 0 0 0 1-1V9.5" />
  </svg>
);

export const IconLibrary = (p) => (
  <svg {...S(p)}>
    <rect x="3.5" y="6" width="13" height="13" rx="2" />
    <path d="M8 3.5h11a2 2 0 0 1 2 2v11" />
  </svg>
);

export const IconSearch = (p) => (
  <svg {...S(p)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </svg>
);

export const IconPlay = (p) => (
  <svg {...S(p)}>
    <path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none" />
  </svg>
);

export const IconPause = (p) => (
  <svg {...S(p)}>
    <rect x="7" y="5.5" width="3.6" height="13" rx="1" fill="currentColor" stroke="none" />
    <rect x="13.4" y="5.5" width="3.6" height="13" rx="1" fill="currentColor" stroke="none" />
  </svg>
);

export const IconBack = (p) => (
  <svg {...S(p)}>
    <path d="M15 5.5 8.5 12l6.5 6.5" />
  </svg>
);

export const IconFwd = (p) => (
  <svg {...S(p)}>
    <path d="m9 5.5 6.5 6.5L9 18.5" />
  </svg>
);

export const IconVolume = (p) => (
  <svg {...S(p)}>
    <path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z" />
    <path d="M15.5 9.5a4 4 0 0 1 0 5" />
    <path d="M18 7.5a7.5 7.5 0 0 1 0 9" />
  </svg>
);

export const IconVolumeMute = (p) => (
  <svg {...S(p)}>
    <path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z" />
    <path d="m15.5 9.5 5 5m0-5-5 5" />
  </svg>
);

export const IconSettings = (p) => (
  <svg {...S(p)}>
    <path d="M12 4v2m0 12v2m5.7-10.2 1.7 1m-12 7 1.7 1M4 12h2m12 0h2M19.3 7.2l-1.7-1M5.4 16.6l1.7 1" />
    <circle cx="12" cy="12" r="3.2" />
  </svg>
);

export const IconExit = (p) => (
  <svg {...S(p)}>
    <path d="M14.5 8V5.5a1.5 1.5 0 0 0-1.5-1.5H6a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 6 20h7a1.5 1.5 0 0 0 1.5-1.5V16" />
    <path d="m18.5 8.5-2.5 3.5 2.5 3.5" />
  </svg>
);

export const IconHeart = (p) => (
  <svg {...S(p)}>
    <path d="M12 19.5s-7-4.4-7-9.3C5 7.6 6.9 6 9 6c1.2 0 2.2.6 3 1.6C12.8 6.6 13.8 6 15 6c2.1 0 4 1.6 4 4.2 0 4.9-7 9.3-7 9.3z" />
  </svg>
);

export const IconClock = (p) => (
  <svg {...S(p)}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v4.5l3 1.8" />
  </svg>
);

export const IconStar = (p) => (
  <svg {...S(p)}>
    <path d="m12 4.5 2.2 4.8 5.3.6-4 3.5 1.1 5.2-4.6-2.8-4.6 2.8 1.1-5.2-4-3.5 5.3-.6z" />
  </svg>
);

export const IconFilm = (p) => (
  <svg {...S(p)}>
    <rect x="3.5" y="5" width="17" height="14" rx="2" />
    <path d="M3.5 9.5h17M3.5 14.5h17M8 5v4.5M8 14.5V19M16 5v4.5M16 14.5V19" />
  </svg>
);

export const IconTv = (p) => (
  <svg {...S(p)}>
    <rect x="3.5" y="7" width="17" height="12" rx="2" />
    <path d="M8 3.5 12 7l4-3.5M12 19v2.5" />
  </svg>
);

export const IconBroadcast = (p) => (
  <svg {...S(p)}>
    <circle cx="12" cy="14" r="2.1" fill="currentColor" stroke="none" />
    <path d="M8.3 11.3a5.2 5.2 0 0 1 7.4 0M5.6 8.6a9 9 0 0 1 12.8 0" />
    <path d="M12 16.1V20" />
  </svg>
);

export const IconMusicNote = (p) => (
  <svg {...S(p)}>
    <path d="M9 18.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" />
    <path d="M11.5 16.5V5.5l7-1.5v11" />
    <path d="M18.5 15.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" />
  </svg>
);

export const IconInfo = (p) => (
  <svg {...S(p)}>
    <circle cx="12" cy="12" r="8.2" />
    <path d="M12 11v5.5" />
    <circle cx="12" cy="8" r="0.15" fill="currentColor" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);
