<img src="assets/icon.svg" width="48" height="48" alt="">

# Skylens

Skylens compares hourly forecasts for the same location and time. Search for a city (for example, `Portland, OR` or `Portland, Maine`) or use the location-pin button to request your device location. Detected locations use the device time zone. Browse through the last hour available from your selected sources, up to 16 forecast days. Enable NOAA GFS and DWD ICON in the source list to compare individual models delivered by Open-Meteo. The largest difference links to the exact forecast values. Source selections, favorites, units, and the last location are stored in the current browser.

Additional models include ECMWF IFS, Canada GEM, Japan JMA, Météo-France, and the UK Met Office. Enable them in **Sources** to compare their hourly forecasts, or star them for the favorites filter. All seven individual models are delivered through Open-Meteo and start disabled. Each has its own chart color and line pattern. Forecast range and available metrics vary by model; unavailable hours and fields remain blank.

## Run locally

Use Node.js 22 or later.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3000. Set `PORT` to use a different port. The build outputs a self-contained Worker module at `dist/server/index.js`. The local Node server serves the same build used by Sites. Set `WEATHER_CONTACT` to your deployment URL or operator email when hosting independently so MET Norway and the National Weather Service can identify the client.

The private Sites deployment uses `SKYLENS_REQUIRE_SIGN_IN=1` to require a visitor identity from Sites' sign-in gateway.

## GitHub Pages

The public site is hosted at https://undeadcommander.github.io/weather/. Pushes to `master` run `.github/workflows/pages.yml`, which tests the app, builds the static site, runs the Pages browser tests, and deploys through GitHub Actions. In the repository's **Settings → Pages**, the build source must be **GitHub Actions**.

Run `npm run build:pages` to generate `dist/pages`, then `npm run test:pages` to test that build. Assets use relative paths so the site works under the repository's `/weather/` path or a custom domain. The existing `npm run build` command still builds the Worker deployment.

GitHub Pages has no server-side API. Its build requests forecasts and city search directly from the providers without cookies or credentials. MET Norway and NWS responses use the same validation and normalization as the Worker, including NWS endpoint validation, four-decimal coordinates, request timeouts, and an in-memory forecast cache that honors provider expiry. MET Norway receives the site's origin for client identification. Provider availability, browser CORS policies, and provider traffic limits still apply; the Pages build does not use the private Sites backend.

## Tests

```sh
npm test
npx playwright install chromium
npm run test:e2e
npm run build
npm run test:live
```

The unit and API tests use controlled fixtures. The browser suite runs the built app and covers keyboard and pointer interaction, preferences, coverage, provider failures, and accessibility. `SKYLENS_BROWSER` can point to an installed Chromium browser. The live checks use current forecasts and need network access.

## Forecast data

- Open-Meteo and MET Norway provide global coverage. The National Weather Service covers U.S. locations and territories. Open-Meteo also supplies city search. [Open-Meteo](https://open-meteo.com/) · [MET Norway](https://www.met.no/en) · [National Weather Service](https://www.weather.gov/)
- Skylens aligns readings in UTC and displays them in the city's time zone. It reports rain probability for the hour starting at the displayed time. MET Norway's compact feed has no rain probability, and its longer-range samples can be several hours apart. Missing values remain missing.
- Forecast requests to Open-Meteo go directly from the browser to its public API without cookies or a referrer. The same-origin backend serves the other feeds and city search. It validates requests, fetches only known provider endpoints, applies timeouts and per-client rate limits, and caches results. The dashboard labels cached forecasts.
- Open-Meteo's free API is intended for non-commercial use. Review the providers' terms before using this build in a commercial deployment. [Open-Meteo terms](https://open-meteo.com/en/terms) · [MET Norway terms](https://api.met.no/doc/TermsOfService)
- The cloud image is from Unsplash. DM Sans is distributed under the SIL Open Font License. [Cloud photograph](https://images.unsplash.com/photo-1501630834273-4b5604d2ee31) · [Font license](web/assets/dm-sans-OFL.txt)
