/** Per-service Google product marks for the home page's 8-service grid,
 * keyed by display name. Simplified single-SVG versions of each product
 * icon — legible at ~20px, no image assets to load. */
export const GOOGLE_SERVICE_LOGOS: Record<string, React.ReactNode> = {
  Gmail: (
    <svg viewBox="0 0 24 24" className="h-full w-full">
      <path d="M2 7.7v10.8A1.5 1.5 0 0 0 3.5 20H6v-9.2L2 7.7z" fill="#4285F4" />
      <path d="M22 7.7v10.8a1.5 1.5 0 0 1-1.5 1.5H18v-9.2l4-3.1z" fill="#34A853" />
      <path
        d="M6 10.8 2 7.7V6.2c0-1.24 1.42-1.94 2.4-1.2L12 10.7l7.6-5.7c.98-.74 2.4-.04 2.4 1.2v1.5l-4 3.1-6 4.5-6-4.5z"
        fill="#EA4335"
      />
      <path d="M2 6.2v1.5l4 3.1V6.2L4.4 5C3.42 4.26 2 4.96 2 6.2z" fill="#FBBC04" />
    </svg>
  ),
  Calendar: (
    <svg viewBox="0 0 24 24" className="h-full w-full">
      <rect x="2.5" y="2.5" width="19" height="19" rx="2.5" fill="#1A73E8" />
      <rect x="6" y="6" width="12" height="12" fill="#fff" />
      <text
        x="12"
        y="15.5"
        textAnchor="middle"
        fontSize="8"
        fontWeight="700"
        fill="#1A73E8"
        fontFamily="Arial, Helvetica, sans-serif"
      >
        31
      </text>
    </svg>
  ),
  Drive: (
    <svg viewBox="0 0 87.3 78" className="h-full w-full">
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066DA" />
      <path d="M43.65 25 29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44A9.06 9.06 0 0 0 0 53h27.5z" fill="#00AC47" />
      <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75L86.1 57.5c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.5z" fill="#EA4335" />
      <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832D" />
      <path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684FC" />
      <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#FFBA00" />
    </svg>
  ),
  Docs: (
    <svg viewBox="0 0 24 24" className="h-full w-full">
      <path
        d="M14.7 2H6.5A1.5 1.5 0 0 0 5 3.5v17A1.5 1.5 0 0 0 6.5 22h11a1.5 1.5 0 0 0 1.5-1.5V6.3L14.7 2z"
        fill="#4285F4"
      />
      <path d="M14.7 2v4.3H19L14.7 2z" fill="#A1C2FA" />
      <path d="M8.5 11.5h7M8.5 14h7M8.5 16.5h4.5" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  Sheets: (
    <svg viewBox="0 0 24 24" className="h-full w-full">
      <path
        d="M14.7 2H6.5A1.5 1.5 0 0 0 5 3.5v17A1.5 1.5 0 0 0 6.5 22h11a1.5 1.5 0 0 0 1.5-1.5V6.3L14.7 2z"
        fill="#0F9D58"
      />
      <path d="M14.7 2v4.3H19L14.7 2z" fill="#87CEAC" />
      <path d="M8.5 10.5h7v6.5h-7z" fill="none" stroke="#fff" strokeWidth="1.2" />
      <path d="M8.5 13.75h7M12 10.5V17" stroke="#fff" strokeWidth="1.2" />
    </svg>
  ),
  Slides: (
    <svg viewBox="0 0 24 24" className="h-full w-full">
      <path
        d="M14.7 2H6.5A1.5 1.5 0 0 0 5 3.5v17A1.5 1.5 0 0 0 6.5 22h11a1.5 1.5 0 0 0 1.5-1.5V6.3L14.7 2z"
        fill="#F4B400"
      />
      <path d="M14.7 2v4.3H19L14.7 2z" fill="#FADA80" />
      <rect x="8.5" y="11" width="7" height="5.5" rx="0.5" fill="none" stroke="#fff" strokeWidth="1.3" />
    </svg>
  ),
  Contacts: (
    <svg viewBox="0 0 24 24" className="h-full w-full">
      <rect x="2.5" y="2.5" width="19" height="19" rx="4" fill="#1A73E8" />
      <circle cx="12" cy="9.5" r="3" fill="#fff" />
      <path d="M12 13.8c-2.9 0-5.3 1.7-6 4.2h12c-.7-2.5-3.1-4.2-6-4.2z" fill="#fff" />
    </svg>
  ),
  Tasks: (
    <svg viewBox="0 0 24 24" className="h-full w-full">
      <circle cx="12" cy="12" r="9.5" fill="#1A73E8" />
      <path
        d="m7.8 12.4 2.8 2.8 5.6-5.6"
        stroke="#fff"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
};

export const SERVER_LOGOS: Record<string, React.ReactNode> = {
  "gws-mcp": (
    <svg viewBox="0 0 24 24" className="h-full w-full">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  ),
  "atlassian-mcp": (
    <svg viewBox="0 0 24 24" className="h-full w-full">
      <path d="M7.12 11.08c-.15-.2-.37-.2-.49.02L2.05 20.86c-.12.22-.01.4.24.4h5.96c.12 0 .28-.1.34-.24.82-1.82.46-4.58-1.47-9.94z" fill="#2684FF" />
      <path d="M11.35 2.31c-2.45 4.36-2.57 8.14-.72 12.27l2.56 5.28c.12.24.32.24.44.24h5.96c.24 0 .36-.18.24-.4L12.04 2.33c-.12-.2-.37-.24-.49-.08l-.2.06z" fill="#2684FF" />
    </svg>
  ),
};
