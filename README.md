<img src="assets/icon.svg" width="48" height="48" alt="">

# Skylens

Skylens compares hourly forecasts for the same location and time. Search for a city, choose sources, and compare temperature, rain chance, or wind for today and the next two days. The largest difference links to the exact forecast values. Source selections, favorites, units, and the last city are stored in the current browser.

## Run locally

Use Node.js 22 or later.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3000. Set `PORT` to use a different port. The build outputs a self-contained Worker module at `dist/server/index.js`. The local Node server serves the same build used by Sites. Set `WEATHER_CONTACT` to your deployment URL or operator email when hosting independently so MET Norway and the National Weather Service can identify the client.

The private Sites deployment uses `SKYLENS_REQUIRE_SIGN_IN=1` to require a visitor identity from Sites' sign-in gateway.

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
