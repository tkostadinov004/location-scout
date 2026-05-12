import express from "express";
import { fetch_osm_tags } from "./utils/osm_tag_fetcher";
import { fetch_from_osm } from "./utils/osm_data_fetcher";
import { fetch_properties } from "./utils/properties_for_rent";
import { FeatureCollection, GeometryObject } from "geojson";
import path from "path";
var GeoJSON = require("geojson");
require("dotenv").config();
const port = "3000";
const public_dir = "public";

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.static("public"));
app.use("/api", require("./api"));

app.get("/fetch/objects", async (req, res) => {
  const query_string = req.body.query_string;
  if (!query_string) {
    throw new Error("Query string is not present!");
  }

  const osm_tags: string[] = await fetch_osm_tags(query_string.toString());
  const osm_data: FeatureCollection<GeometryObject> =
    await fetch_from_osm(osm_tags);
  res.send(osm_data);
});

app.get("/fetch/propertiesForRent", async (_req, res) => {
  const result = await fetch_properties();
  const geoJson = GeoJSON.parse(result, { Point: ["lat", "lon"] });
  res.send(geoJson);
});

app.get("/", (req, res) => {
  res.sendFile(path.join(public_dir, "index.html"));
});

app.get("/image", (req, res) => {
  const name = req.query.image_name;
  if (!name) {
    res.status(400).send(`Image name not provided!`);
    return;
  }
  res.sendFile(name.toString(), { root: public_dir });
});

app.listen(port, () => {
  console.log(`Geodata scraper app listening on port ${port}`);
});
