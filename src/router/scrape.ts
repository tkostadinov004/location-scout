import express from "express";
import { fetch_osm_tags } from "../services/scrape/osm_tag_fetcher";
import { FeatureCollection, GeometryObject } from "geojson";
import { scrape_osm } from "../services/scrape/osm_scraper";
import { fetch_properties } from "../services/scrape/properties_for_rent";

var GeoJSON = require("geojson");
const router = express.Router();

router.get("/objects", async (req, res) => {
  const query_string = req.body.query_string;
  if (!query_string) {
    throw new Error("Query string is not present!");
  }

  const osm_tags: string[] = await fetch_osm_tags(query_string.toString());
  const result: FeatureCollection<GeometryObject> = await scrape_osm(osm_tags);
  res.send(result);
});

router.get("/forRent", async (_req, res) => {
  const result = await fetch_properties();
  const geoJson = GeoJSON.parse(result, { Point: ["lat", "lon"] });
  res.send(geoJson);
});

module.exports = router;
