<img src="assets/icon.svg" width="48" height="48" alt="">

# Skylens

**See how much weather forecasts agree before you trust any one of them.**

Most weather apps show a single forecast. Skylens shows several side by side for the same place and hour. Where the forecasts agree, you can plan with more confidence. Where they disagree, you know the weather is less certain.

**[Open Skylens →](https://undeadcommander.github.io/weather/)**

## Why compare forecasts?

Every forecast comes from a numerical weather model. Each model starts from slightly different data, uses different physics and resolution, and runs on its own schedule. When models agree, the atmosphere is usually behaving predictably. When they spread apart, for example by a 10° difference in tomorrow's high or a 20% chance of rain against 80%, the forecast is uncertain. A single app's number hides that.

Skylens puts the forecasts in one chart so you can see that spread for yourself.

## What you can do

- **Compare hour by hour.** Chart temperature, rain chance, and wind from every selected source on one timeline, in the location's local time, up to 16 days ahead.
- **Find the biggest disagreement.** The *Greatest difference* panel shows where the sources disagree most and links to the exact values behind it.
- **See the overall picture.** The headline reading averages all reporting sources, and the humidity, wind, and rain figures use their median. Hover over the chart to see those readings for any hour.
- **Scan conditions and snow.** An hourly outlook table shows each source's predicted sky conditions and snowfall. Click a row to see the details for that hour.
- **Look up any place.** Search for a city or state, such as `Portland, OR` or `Portland, Maine`, or use your device's location.
- **Choose your sources.** Choose from more than 30 forecasts, from global models to high-resolution regional ones. Turn sources on or off, star favorites, and filter the comparison to favorites only.
- **Make it yours.** Switch between °F/mph and °C/km/h, light and dark mode, and six color palettes. Skylens remembers your choices and last location in your browser.

Skylens also works with a keyboard and screen readers. You can step through the chart's hours with the arrow keys, and every value is also available in a table.

## Forecast sources

By default, Skylens compares three widely used forecast services:

| Source | Coverage |
| --- | --- |
| [Open-Meteo](https://open-meteo.com/) | Global, blended from several models |
| [MET Norway](https://www.met.no/en) | Global, from the Norwegian Meteorological Institute |
| [National Weather Service](https://www.weather.gov/) | United States and its territories |

You can also add more sources from the source list. Most are individual models, delivered through Open-Meteo:

- **Global models:** NOAA GFS (US), DWD ICON (Germany), ECMWF IFS and ECMWF HRES 9 km (Europe), Canada GEM, Japan JMA, Météo-France, UK Met Office, and China CMA GRAPES
- **AI models:** ECMWF AIFS, DWD AICON, and NOAA AIGFS
- **Ensemble:** NOAA HGEFS Ensemble Mean, the average of NOAA's hybrid ensemble members
- **Station forecasts:** DWD MOSMIX, the German Weather Service's statistical forecasts for weather stations worldwide, delivered through [Bright Sky](https://brightsky.dev/)
- **North American regional models:** NOAA HRRR and National Blend of Models (continental US), Canada RDPS, HRDPS, and HRDPS West
- **European regional models:** DWD ICON-D2 and ICON-EU, Météo-France AROME, AROME HD, and ARPEGE Europe, UK Met Office UKV, KNMI and DMI HARMONIE-AROME, MetCoOp Nordic, MeteoSwiss ICON-CH, and Italia Meteo ICON-2I
- **Asian regional model:** Japan JMA MSM

Regional models only cover their own part of the world. Skylens marks them *Outside coverage* anywhere else.

Each source has its own chart color and line pattern. Forecast range and available measurements vary by source, and Skylens leaves missing hours and fields blank rather than filling them in.

## How the numbers are handled

- Skylens aligns every forecast to the same hours in UTC and shows them in the location's time zone.
- Rain chance applies to the hour that begins at the time shown. MET Norway doesn't publish rain chance, and its longer-range forecasts can be several hours apart.
- When the National Weather Service gives a wind range, Skylens uses its midpoint.
- DWD MOSMIX doesn't publish rain chance for most places, and Skylens estimates its humidity from the dew point when the station doesn't report it.
- Skylens labels forecasts that come from its cache.

## Privacy

Skylens has no accounts, no tracking, and no cookies. Preferences stay in your browser's local storage. If you use your device's location, Skylens rounds it to about 100 meters and uses it only to request forecasts from the providers. It keeps your last location in your browser for 30 days so the next lookup can show weather right away, and forgets it if you take away location access.

## Credits

Forecast data comes from [Open-Meteo](https://open-meteo.com/), [MET Norway](https://www.met.no/en), the [National Weather Service](https://www.weather.gov/), and [Bright Sky](https://brightsky.dev/), which serves data from the [German Weather Service](https://www.dwd.de/EN/). Open-Meteo's free API is for non-commercial use. See the [Open-Meteo terms](https://open-meteo.com/en/terms) and [MET Norway terms](https://api.met.no/doc/TermsOfService). The cloud image is from [Unsplash](https://images.unsplash.com/photo-1501630834273-4b5604d2ee31). DM Sans is distributed under the [SIL Open Font License](web/assets/dm-sans-OFL.txt).
