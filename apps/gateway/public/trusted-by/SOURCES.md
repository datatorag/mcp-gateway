# "Trusted by" marks

The marks in the home page's "Trusted by" row. Each is its organization's
trademark, self-hosted (never hotlinked), and showing it implies no
endorsement. None was redrawn. On the dark hero the marks are
shown in white, by a CSS filter or the organization's own white file; the
files here are unchanged except as the table says.

Collected 2026-11-20.

| File | Organization | Source | Changed |
|---|---|---|---|
| `indoff.svg`, `indoff-white.svg` | Indoff | indoff.com (`/wp-content/uploads/2019/12/`) | no |
| `westwing.svg` | Westwing | Wikimedia Commons, `File:Westwing-Logo-2023.svg` | no |
| `factorial-wordmark-s.png` | Factorial | Wikimedia Commons, "Factorial company logo in radical red color with text saying Factorial in Fira font type" | resized to 900 wide |
| `fourpoint-clear.png` | Four Point Advisory | fourpoint.com.au (`/images/logo.png`) | white background cleared; icon only |
| `cobach-s.png` | Colegio de Bachilleres del Estado de Chihuahua | Wikimedia Commons, `File:Logo-COBAChih.png` | resized to 900 wide |
| `smabosa.png` | SMA BOPKRI 1 Yogyakarta | smabosa-yogya.sch.id (site identity icon, 180 px) | no |

The list itself is `src/lib/trusted-by.ts`. To remove an organization, delete
its entry there, its files here, and its row above.
