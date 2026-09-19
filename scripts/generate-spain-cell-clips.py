#!/usr/bin/env python3
"""Precompute Spain-only H3 geometries without masking the basemap."""

import json
from pathlib import Path

import h3
from shapely.geometry import Polygon, shape
from shapely.ops import unary_union
from shapely.prepared import prep

ROOT = Path(__file__).resolve().parent.parent
CELLS = ROOT / "public" / "data" / "grootguard-cells.json"
BOUNDARY = ROOT / "public" / "data" / "spain-boundary.geojson"
OUTPUT = ROOT / "public" / "data" / "spain-cell-clips.json"


def cell_polygon(cell):
    ring = [[lng, lat] for lat, lng in h3.cell_to_boundary(cell)]
    return Polygon(ring)


def multipolygon_coordinates(geometry):
    if geometry.geom_type == "Polygon":
        return [
            [list(geometry.exterior.coords)]
            + [list(ring.coords) for ring in geometry.interiors]
        ]
    return [
        [list(part.exterior.coords)] + [list(ring.coords) for ring in part.interiors]
        for part in geometry.geoms
        if part.geom_type == "Polygon"
    ]


def main():
    cells = json.loads(CELLS.read_text())["cells"]
    boundary = unary_union(
        [shape(feature["geometry"]) for feature in json.loads(BOUNDARY.read_text())["features"]]
    )
    prepared_boundary = prep(boundary)
    excluded = []
    clipped = {}

    for cell in cells:
        polygon = cell_polygon(cell)
        if prepared_boundary.covers(polygon):
            continue
        intersection = boundary.intersection(polygon)
        if intersection.is_empty:
            excluded.append(cell)
            continue
        clipped[cell] = multipolygon_coordinates(intersection)

    OUTPUT.write_text(
        json.dumps({"excluded": excluded, "clipped": clipped}, separators=(",", ":"))
        + "\n"
    )
    print(f"Wrote {len(clipped)} clipped and {len(excluded)} excluded cells")


if __name__ == "__main__":
    main()
