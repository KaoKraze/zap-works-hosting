# Third-party libraries

| File | Library | Version | License |
| --- | --- | --- | --- |
| gsap.min.js, ScrollTrigger.min.js, SplitText.min.js | GSAP — https://gsap.com | 3.15.1 | GSAP Standard License ("no charge" license, https://gsap.com/standard-license). All GSAP plugins, including SplitText, are free to use. |
| lenis.min.js | Lenis — https://github.com/darkroomengineering/lenis | 1.3.27 | MIT |

Lenis was bundled from the official repository source (`packages/core/src/lenis.ts`, exposed as `window.Lenis`) with esbuild, because the
repository download does not include a prebuilt browser file. GSAP files are the unmodified `dist/` builds.

Fonts in /fonts (Archivo, Inter, JetBrains Mono) are licensed under the SIL Open Font License 1.1.
