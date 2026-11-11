# AltMeter

Elevation above sea level and current weather for your GPS position, any city in the world, or any point you tap on the map. Works in desktop and mobile browsers. No build step, no API keys, no backend.

## Features
- **My position**: browser GPS, showing the device's GPS altitude (when the device reports it) and the ground elevation from a terrain model.
- **City search**: worldwide autocomplete; each result shows its elevation.
- **Drop a pin**: tap or click anywhere on the map.
- **Weather**: temperature, feels-like, high/low, humidity, dew point, wind and gusts, sea-level and surface pressure, clouds, precipitation, UV, visibility, sunrise and sunset.
- Streets, topographic and satellite base maps; metric/imperial toggle; saved pins (stored in the browser); shareable links (`/#lat,lon`); light and dark mode.

## Free data sources
| What | Source |
|---|---|
| Elevation | [Open-Meteo Elevation API](https://open-meteo.com/en/docs/elevation-api) (Copernicus DEM GLO-90, ~90 m) |
| Weather | [Open-Meteo Forecast API](https://open-meteo.com) |
| City search | [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api) (GeoNames) |
| Place names for pins | [Nominatim](https://nominatim.org) (OpenStreetMap) |
| Map | [Leaflet](https://leafletjs.com), OpenStreetMap, OpenTopoMap, Esri World Imagery |

Open-Meteo is free for non-commercial use (about 10,000 calls a day per user IP). If the app becomes commercial, check their terms.

## Run locally
```bash
python3 -m http.server 8765
```
Then open http://localhost:8765. Geolocation works only on `localhost` or HTTPS.

## Deploy (Cloudflare Pages + GitHub)
1. Push this folder to a GitHub repository.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → choose the repo.
3. Framework preset: **None**, build command: empty, output directory: `/`.
4. **Settings → Variables and Secrets → Add** (Production): type *Secret*, name `SITE_PASSWORD`, value = the password. Then **Deployments → Retry deployment** so it takes effect.
5. **Custom domains → Set up a custom domain** → `altmeter.sasagr.uk`.

## Password protection
`functions/_middleware.js` gates every page behind a login form. The password lives only in the `SITE_PASSWORD` secret in Cloudflare (never in this repo). After signing in, the browser stays signed in for 30 days; visit `/__logout` to sign out. Changing the secret signs everyone out. Until the secret is set, the site answers "Not configured".

Local `python3 -m http.server` skips the gate. To test it locally, use `npx wrangler pages dev . --binding SITE_PASSWORD=something`.

Every push to `main` redeploys automatically.
