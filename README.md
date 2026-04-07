# Coconut Polygon Verification Tool — Tamil Nadu 2020

Interactive web-based tool for visually verifying coconut training labels across all 38 districts of Tamil Nadu using high-resolution Google satellite imagery.

## Live Demo

**[Open the Verification Tool](https://athithiyanmr.github.io/coconut_verification_tool/)**

## About

This tool was built to validate coconut plantation training labels derived from the **Descals et al. (2023)** coconut training dataset (`labels_coconut_raw_2020_tamilnadu.tif`). The raster labels were vectorized into **90,438 polygons** and spatially joined with Tamil Nadu district boundaries.

Each polygon is assigned a unique ID per district, allowing systematic verification against Google satellite imagery.

## Features

- **District-based navigation** — Select any of 38 Tamil Nadu districts
- **Google Satellite basemap** — High-resolution imagery for visual verification
- **Polygon overlay toggle** — Show/hide the training label overlay to see the actual land cover beneath
- **One-click verification** — Mark each polygon as "Coconut" or "Not Coconut"
- **Progress tracking** — Real-time progress bar with Yes/No/Pending counts
- **Filter polygons** — View All, Pending, Yes, or No polygons
- **Keyboard shortcuts** — Y (Yes), N (No), S/Space (Skip), T (Toggle), Arrow keys (Navigate)
- **Export results** — Download verification results as CSV or GeoJSON

## Data

| Metric | Value |
|--------|-------|
| Source Raster | `labels_coconut_raw_2020_tamilnadu.tif` |
| Resolution | ~20m (Sentinel-2) |
| CRS | EPSG:4326 (WGS84) |
| Total Polygons | 90,438 |
| Total Area | 245,569 ha (2,456 km²) |
| Districts | 38 |
| Area Projection | UTM Zone 44N (EPSG:32644) |

## How to Use

1. Open the tool in your browser
2. Select a district from the dropdown
3. Click on any numbered polygon (or use the sidebar list)
4. Toggle the overlay off to inspect the satellite image
5. Click **"Yes — Coconut"** or **"No — Not Coconut"**
6. The tool auto-advances to the next polygon
7. Export your results when done

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Y` | Mark as Coconut |
| `N` | Mark as Not Coconut |
| `S` / `Space` | Skip to next |
| `T` | Toggle overlay |
| `←` / `→` | Previous / Next polygon |
| `Esc` | Close verification panel |

## Tech Stack

- **Leaflet.js** — Interactive mapping
- **Google Satellite Tiles** — Basemap imagery
- **GeoJSON** — Polygon data per district
- **Vanilla HTML/CSS/JS** — No build step required

## Running Locally

```bash
# Clone the repository
git clone https://github.com/Athithiyanmr/coconut_verification_tool.git
cd coconut_verification_tool

# Serve with any static server
python -m http.server 8000
# or
npx serve .
```

Open `http://localhost:8000` in your browser.

## Data Processing Pipeline

1. Raster vectorization using `rasterio.features.shapes()`
2. Spatial join with Tamil Nadu district boundaries (`geopandas.sjoin`)
3. Area calculation in UTM 44N projection
4. Geometry simplification + coordinate rounding for web performance
5. Per-district GeoJSON export with unique polygon IDs

## License

MIT

## Author

**Athithiyan** — [GitHub](https://github.com/Athithiyanmr)
