import express from "express";
import { fetch_osm_tags } from "./services/osm_tag_fetcher";
import { fetch_from_osm } from "./services/osm_data_fetcher";
import { fetch_properties } from "./services/properties_for_rent";
var GeoJSON = require("geojson");
require("dotenv").config();
const app = express();
app.use(express.json());
const port = "3000";

app.get("/objects", async (req, res) => {
  const query_string = req.body.query_string;
  if (!query_string) {
    throw new Error("Query string is not present!");
  }

  const osm_tags: string[] = await fetch_osm_tags(query_string.toString());
  const osm_data: string = await fetch_from_osm(osm_tags);
  res.send(osm_data);
});

app.get("/propertiesForRent", async (_req, res) => {
  const result = await fetch_properties();
  const geoJson = GeoJSON.parse(result, { Point: ["lat", "lon"] });
  res.send(geoJson);
});

app.listen(port, () => {
  console.log(`Geodata scraper app listening on port ${port}`);
});
