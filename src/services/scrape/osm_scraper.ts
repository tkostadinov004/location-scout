"use strict";

import axios from "axios";
import axiosRetry from "axios-retry";
import { FeatureCollection, GeometryObject } from "geojson";
import osmtogeojson from "osmtogeojson";

const retry_client = axios.create();

axiosRetry(retry_client, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) => axiosRetry.isNetworkOrIdempotentRequestError(error),
});

export async function scrape_osm(osm_tags: string[]): Promise<FeatureCollection<GeometryObject>> {
  const nwr_queries: string[] = osm_tags.map((t) => `nwr[${t}](42.590415, 23.218098, 42.786280, 23.492111);`);
  const overpass_query: string = `
    [out:json][timeout:25];
    (
      ${nwr_queries.join(" ")}   
    );
    out ids geom;
  `;
  console.log(overpass_query);

  const overpass_response = await retry_client.post("https://overpass-api.de/api/interpreter", `data=${encodeURIComponent(overpass_query)}`, {
    headers: {
      "User-Agent": "PAWS (https://github.com/tkostadinov004/location-scout)",
      Referer: "https://github.com/tkostadinov004/location-scout",
    },
  });
  return osmtogeojson(overpass_response.data);
}
