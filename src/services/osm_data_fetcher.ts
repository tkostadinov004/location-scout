"use strict";

import axios from "axios";

export async function fetch_from_osm(osm_tags: string[]) : Promise<string> {
  const nwr_queries: string[] = osm_tags.map(
    (t) => `nwr[${t}](42.590415, 23.218098, 42.786280, 23.492111);`,
  );
  const overpass_query: string = `
    [out:json][timeout:25];
    (
      ${nwr_queries.join(" ")}    
    );
    out body;
    >;
    out skel qt;
  `;
  console.log(overpass_query);
  const overpass_response = await axios.post(
    "https://overpass-api.de/api/interpreter",
    `data=${encodeURIComponent(overpass_query)}`,
    {
      headers: {
        "User-Agent": "PAWS (https://github.com/tkostadinov004/ragis)",
        Referer: "https://github.com/tkostadinov004/ragis",
      },
    },
  );
  return overpass_response.data;
}
