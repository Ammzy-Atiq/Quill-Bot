# QUILL GUARD — Brand

The logo is `quill-logo.webp`: a single-stroke quill feather drawn with a gold → ember
gradient on a near-black navy background. Tokens are also exported from
`packages/shared/src/brand.ts` (`BRAND`) — import them instead of copying hex values.

| Token     | Hex       | Use                                          |
|-----------|-----------|----------------------------------------------|
| `ink`     | `#000712` | Page background (the logo background)        |
| `surface` | `#0A1220` | Cards / raised surfaces                      |
| `line`    | `#1B2536` | Borders, dividers                            |
| `text`    | `#F4F1EA` | Primary text (warm off-white)                |
| `muted`   | `#8C96A8` | Secondary text                               |
| `gold`    | `#F2AC2B` | Brightest quill highlight, primary accents   |
| `amber`   | `#D98A1A` | Gradient middle, hover states                |
| `ember`   | `#B4550A` | Gradient end, pressed states                 |
| `success` | `#3FB67B` | Success states                               |
| `danger`  | `#E5484D` | Destructive actions, errors                  |

**Gradient:** `linear-gradient(135deg, #F2AC2B 0%, #D98A1A 50%, #B4550A 100%)` — use it for
the logo mark, primary buttons and hero accents, never for large text blocks.

**Voice:** calm, precise, protective. "QUILL GUARD" in caps for the product name, "QUILL" as
the short name. Credit line: *Made by Atiq Ur Rahman*.

**Discord:** bot messages use Components V2 containers **without an accent colour** (no side
bar). Brand colour never appears inside Discord messages — only the logo as a thumbnail.
