# Coconut Polygon Verification Tool — Tamil Nadu 2020

Interactive web tool for visually verifying coconut plantation training labels across all **38 districts** of Tamil Nadu. Built for collaborative validation of the Descals et al. (2023) coconut training dataset using Google satellite imagery.

> **Live tool:** [athithiyanmr.github.io/coconut_verification_tool](https://athithiyanmr.github.io/coconut_verification_tool/)

---

## Overview

Coconut plantation mapping using satellite imagery requires high-quality training labels. The [Descals et al. (2023)](https://doi.org/10.5281/zenodo.6467662) dataset provides raster-based coconut labels derived from Sentinel-2 imagery, but visual verification against high-resolution satellite imagery is essential to assess label accuracy.

This tool vectorizes the raster labels into **90,438 individual polygons**, overlays them on Google Satellite imagery, and provides a streamlined interface for multiple users to collaboratively verify whether each polygon actually represents a coconut plantation.

### Key Numbers

| Metric | Value |
|---|---|
| Total polygons | 90,438 |
| Total coconut area | 245,569 ha (2,456 km²) |
| Districts covered | 38 |
| Source raster | `labels_coconut_raw_2020_tamilnadu.tif` |
| Sentinel-2 resolution | ~20 m |
| CRS | EPSG:4326 (WGS84) |
| Area projection | UTM Zone 44N (EPSG:32644) |

---

## Features

### Verification Workflow
- **District-based navigation** — Select any of 38 districts; polygons load on demand
- **District boundary outline** — White dashed boundary shows the district extent on the map
- **Polygon overlay toggle** — Show/hide the training label overlay to inspect the satellite image beneath
- **One-click verification** — Mark each polygon as "Coconut" or "Not Coconut"
- **Auto-advance** — Automatically moves to the next polygon after verification
- **Progress tracking** — Real-time progress bar with Yes / No / Pending counts
- **Filter polygons** — View All, Pending, Yes, or No polygons in the sidebar

### Collaboration
- **Shared cloud backend** — Verifications are stored in Google Sheets via Apps Script
- **Multi-user support** — Each user enters their name; verifications are attributed (e.g., "by Athithiyan")
- **Real-time sync** — Auto-refreshes every 60 seconds; manual Refresh button available
- **Conflict-safe** — Assign different districts to different people to avoid overlap

### Drawing New Polygons
- **Leaflet.draw integration** — Draw new coconut polygons directly on the map for areas not in the training set
- **Metadata capture** — Each drawn polygon records the user, area (ha), timestamp, and a note
- **Shared storage** — Drawn polygons are saved to the cloud and visible to all users
- **Delete support** — Only the user who drew a polygon can delete it

### Export
| Export | Scope | Format |
|---|---|---|
| Export District (CSV) | Current district | CSV with polygon ID, area, lat/lon, status, verifier, timestamp |
| Export District (GeoJSON) | Current district | GeoJSON with geometry + verification attributes |
| Export All Districts (CSV) | All 38 districts | Combined CSV with summary header (90,438+ rows) |
| Export All Districts (GeoJSON) | All 38 districts | Full FeatureCollection with all polygons + drawn polygons |
| Google Sheet | All data | Raw verification rows, downloadable anytime |

All exports include a `source` column: `training_label` for original polygons, `user_drawn` for manually drawn ones.

### Keyboard Shortcuts

| Key | Action |
|---|---|
| `Y` | Mark as Coconut |
| `N` | Mark as Not Coconut |
| `S` / `Space` | Skip to next |
| `T` | Toggle overlay on/off |
| `←` / `→` | Previous / Next polygon |
| `Esc` | Close verification panel |

---

## Architecture

```
GitHub Pages (frontend)          Google Sheets (backend)
┌────────────────────────┐       ┌──────────────────────────┐
│  index.html             │       │  verifications tab        │
│  style.css              │  ───► │  key | status | user | ts │
│  app.js                 │  GET  │                          │
│  data/*.geojson         │  POST │  drawn_polygons tab       │
│  Leaflet + Leaflet.draw │  ◄─── │  id | district | geom... │
└────────────────────────┘       └──────────────────────────┘
         │                                  │
         ▼                                  ▼
   Google Satellite               Apps Script Web App
   Tiles (basemap)               (CORS-enabled JSON API)
```

- **Frontend:** Static HTML/CSS/JS hosted on GitHub Pages — zero build step
- **Maps:** Leaflet.js with Google Satellite + Labels basemap
- **Drawing:** Leaflet.draw plugin (polygon tool only)
- **Backend:** Google Apps Script web app → reads/writes Google Sheets
- **Data:** Per-district GeoJSON files + district boundary GeoJSON

---

## Setup Guide

### Quick Start (Read-Only)

Just open the [live tool](https://athithiyanmr.github.io/coconut_verification_tool/) — no setup needed to browse polygons and view the map.

### Enable Shared Verification (Google Sheets Backend)

To enable saving verifications across users:

#### 1. Create the Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) → create a new blank spreadsheet
2. Name it **"Coconut Verifier Data"**
3. Rename the first sheet tab to **`verifications`**
4. Add headers in Row 1: `key` | `status` | `user` | `timestamp`
5. Create a second sheet tab named **`drawn_polygons`**
6. Add headers in Row 1: `id` | `district` | `geometry` | `area_ha` | `user` | `timestamp` | `note`

#### 2. Deploy the Apps Script

1. In the Google Sheet → **Extensions → Apps Script**
2. Delete any existing code
3. Paste the contents of [`google_apps_script.js`](google_apps_script.js) from this repository
4. Click **Deploy → New Deployment**
5. Type: **Web app** | Execute as: **Me** | Access: **Anyone**
6. Click **Deploy** → **Authorize** → Copy the Web App URL

#### 3. Configure the Tool

1. Edit [`app.js`](app.js) line 8
2. Replace `PASTE_YOUR_APPS_SCRIPT_URL_HERE` with your Web App URL
3. Commit and push — GitHub Pages will update in ~1 minute

### Running Locally

```bash
git clone https://github.com/Athithiyanmr/coconut_verification_tool.git
cd coconut_verification_tool
python -m http.server 8000
# or: npx serve .
```

Open `http://localhost:8000` in your browser.

---

## Data Processing Pipeline

The raw raster was processed into web-ready GeoJSON using Python:

```
labels_coconut_raw_2020_tamilnadu.tif
        │
        ▼  rasterio.features.shapes() — vectorize coconut pixels (value=1)
   90,438 raw polygons
        │
        ▼  geopandas.sjoin() — assign each polygon to a district
   Polygons tagged with district name
        │
        ▼  Reproject to UTM 44N (EPSG:32644) — calculate area in hectares
   Area calculated per polygon
        │
        ▼  Unique ID per district (1, 2, 3... per district)
   Polygons numbered for systematic verification
        │
        ▼  Simplify geometry + round coordinates to 5 decimal places
   Web-optimized GeoJSON per district
        │
        ▼  district_boundaries.geojson — simplified district outlines
   38 files in data/ folder
```

### Top Districts by Coconut Area

| District | Polygons | Area (ha) | Area (km²) |
|---|---|---|---|
| Coimbatore | 9,235 | 61,469 | 614.7 |
| Tiruppur | 12,091 | 35,379 | 353.8 |
| Kanniyakumari | 3,968 | 24,562 | 245.6 |
| Theni | 3,803 | 20,327 | 203.3 |
| Dindigul | 6,077 | 13,782 | 137.8 |
| Erode | 7,364 | 10,194 | 101.9 |
| Krishnagiri | 4,515 | 9,000 | 90.0 |
| Namakkal | 4,058 | 8,152 | 81.5 |
| Tenkasi | 3,245 | 8,120 | 81.2 |
| Vellore | 3,155 | 7,498 | 75.0 |

---

## File Structure

```
coconut_verification_tool/
├── index.html                    # Main page
├── style.css                     # Styles
├── app.js                        # Application logic
├── google_apps_script.js         # Google Apps Script (paste into Apps Script editor)
├── server.js                     # Optional Express backend (for local/self-hosted use)
├── README.md
├── data/
│   ├── districts.json            # District index (name, polygon count, center, bounds, file path)
│   ├── district_boundaries.geojson  # Simplified district outlines for map display
│   ├── ariyalur.geojson          # Per-district polygon data
│   ├── chennai.geojson
│   ├── coimbatore.geojson
│   └── ... (38 district files)
```

---

## Tech Stack

| Component | Technology |
|---|---|
| Maps | [Leaflet.js](https://leafletjs.com/) 1.9.4 |
| Basemap | Google Satellite + Labels tiles |
| Drawing | [Leaflet.draw](https://leaflet.github.io/Leaflet.draw/) 1.0.4 |
| Backend | [Google Apps Script](https://developers.google.com/apps-script) Web App |
| Storage | Google Sheets |
| Hosting | GitHub Pages |
| Fonts | [DM Sans](https://fonts.google.com/specimen/DM+Sans) (Google Fonts) |

---

## References

- Descals, A., et al. (2023). *High-resolution map of coconut palms using deep learning and openly available satellite images.* [Zenodo dataset](https://doi.org/10.5281/zenodo.6467662)
- Sentinel-2 satellite imagery: [Copernicus Programme](https://sentinel.esa.int/web/sentinel/missions/sentinel-2)
- Tamil Nadu district boundaries: Survey of India

---

## License

MIT

## Author

**Athithiyan** — [GitHub](https://github.com/Athithiyanmr) | Geospatial Data Analyst & Climate Scientist

Built with geospatial Python (rasterio, geopandas, shapely) and vanilla web technologies.
