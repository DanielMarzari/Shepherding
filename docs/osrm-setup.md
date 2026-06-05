# Driving distances — OSRM setup (one-time)

The member map can show **real driving distance + time** from Faith
Church to each home instead of straight-line. We do this with a local
[OSRM](https://github.com/Project-OSRM/osrm-backend) instance built from a
**Pennsylvania OSM extract** — free, runs on the same Oracle host, and
costs ~nothing per query. The app only needs the env var `OSRM_URL`
pointing at it; everything else (compute, caching) is already built.

## Why this design (cheapest long-run)

- **One regional extract**, contracted once (~minutes), reused forever.
- We call OSRM's **`table` service** — one request routes the church to
  ~90 homes at a time — and store only **distance + duration per person**
  (two numbers). No route geometry is stored, so storage is trivial.
- Drives are recomputed **only when a home's coordinates change**, and
  the nightly cron tops up new homes automatically.

## 1. Get the data + build the graph (on the server)

```bash
cd /var/www/apps/shepherdly
mkdir -p osrm && cd osrm

# Pennsylvania extract from Geofabrik (~250 MB).
curl -O https://download.geofabrik.de/north-america/us/pennsylvania-latest.osm.pbf

# Build with the car profile (Docker is the simplest route).
docker run -t -v "$PWD:/data" osrm/osrm-backend \
  osrm-extract -p /opt/car.lua /data/pennsylvania-latest.osm.pbf
docker run -t -v "$PWD:/data" osrm/osrm-backend \
  osrm-partition /data/pennsylvania-latest.osrm
docker run -t -v "$PWD:/data" osrm/osrm-backend \
  osrm-customize /data/pennsylvania-latest.osrm
```

## 2. Run the routing daemon

Bump `--max-table-size` so the church → many-homes table call works
(the app chunks at 90, so 256 is plenty):

```bash
docker run -d --restart unless-stopped \
  --name osrm -p 5000:5000 \
  -v "$PWD:/data" osrm/osrm-backend \
  osrm-routed --algorithm mld --max-table-size 256 \
  /data/pennsylvania-latest.osrm
```

Smoke test:

```bash
curl "http://localhost:5000/table/v1/driving/-75.5844,40.5545;-75.49,40.60?sources=0&annotations=duration,distance"
```

## 3. Point the app at it

Add to the env file PM2 reads (e.g. `.env.production`) and restart:

```
OSRM_URL=http://localhost:5000
```

```bash
pm2 restart shepherdly --update-env
```

## 4. Use it

On `/map`, an admin now sees **“Compute driving distances.”** Click it
once — it runs in the background through every geocoded home (batched,
self-continuing) and the Reach & distance panel switches from
straight-line to real road routing. After that it stays current on its
own via the nightly sync cron.

## Refreshing the map data

Geofabrik updates daily. Re-run step 1 + restart the container monthly-ish
to pick up road changes — not required for it to work.

## Future (not built): route geometry / road heat

Storing the actual route polyline per home (to highlight the roads taken
or build a usage heatmap) is much heavier on storage. If we want it
later, add per-home `/route` calls and aggregate shared road segments —
tracked in ROADMAP.md.
