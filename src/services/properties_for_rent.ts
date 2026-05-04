"use strict";

import axios from "axios";
import * as cheerio from "cheerio";

const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

export class FetchedProperty {
  lat: number = 0;
  lon: number = 0;
  name: string = "";
  url: string = "";
  address: string = "";
  prices: string[] = new Array();
}

const categories: string[] = [
  "ofis",
  "magazin",
  "tyrgovski-obekt",
  "promishlen-imot",
  "zala",
  "sklad",
];

async function fetch_property_details(
  property_url: string,
): Promise<FetchedProperty | null> {
  const full_url = `https://www.imoti.net${property_url}`;
  let result: FetchedProperty = new FetchedProperty();
  result.url = full_url;

  try {
    const resp = await axios.get(full_url);
    const $ = cheerio.load(resp.data);
    $("#iframe-maps").each((_, m) => {
      const embed_url = m.attributes.find((attr) => attr.name == "data-src");
      if (!embed_url) {
        return;
      }
      const coords: string = embed_url.value.split("&")[1].split("=")[1];
      if (coords.match("^0(\.0*)?,0(\.0*)?$")) {
        return;
      }

      result.lat = parseFloat(coords.split(",")[0]);
      result.lon = parseFloat(coords.split(",")[1]);
    });
    if (result.lat == 0 && result.lon == 0) return null;

    result.name = $('h2[itemprop="name"]').html() ?? "";
    if (result.name == "") return null;

    $(".big-price strong").each((_, m) => {
      const val: string | null = $(m).html();
      if (val) {
        result.prices.push(val);
      }
    });

    return result;
  } catch (err) {
    console.error(`Error at listing ${full_url}: \n ${err}`);
    return null;
  }
}

async function fetch_properties_per_category(
  category: string,
): Promise<FetchedProperty[]> {
  let index = 0;
  let pages_count: number | undefined;
  let result: FetchedProperty[] = new Array();
  while (!pages_count || index < pages_count) {
    console.log(`${category} - page ${index + 1}`);
    try {
      const page = await axios.get(
        `https://www.imoti.net/bg/obiavi/r/dava-pod-naem/sofia/${category}?page=${++index}`,
      );
      const $ = cheerio.load(page.data);
      if (!pages_count) {
        pages_count = Number.parseInt($(".last-page").html() ?? "1");
      }

      let listings: string[] = new Array();
      $(".list-view.real-estates .clearfix .box-link").each((_, el) => {
        const link = el.attributes.find((attr) => attr.name == "href");
        if (link) {
          listings.push(link.value.split("?")[0]);
        }
      });

      const fetched_properties: (FetchedProperty | null)[] = await Promise.all(
        listings.map(async (link) => await fetch_property_details(link)),
      );
      result = result.concat(fetched_properties.filter((fp) => fp != null));
    } catch (err) {
      console.error(`Error at page ${index}: \n ${err}`);
    }
  }
  return result;
}

export async function fetch_properties(): Promise<FetchedProperty[]> {
  console.log("Starting property fetch:");
  const result: FetchedProperty[][] = await Promise.all(
    categories.map(
      async (category) => await fetch_properties_per_category(category),
    ),
  );
  const flat_result: FetchedProperty[] = result.flat();
  console.log(
    `Property fetch finished! Total of ${flat_result.length} properties.`,
  );

  for (let index = 0; index < flat_result.length; index++) {
    if (index % 20 == 0) {
      console.log(
        `Reverse geocoding: ${index} / ${flat_result.length} completed.`,
      );
    }

    await sleep(1000); // nominatim allows only 1 request per second
    const reverse_geocoding_response = await axios.get(
      `https://nominatim.openstreetmap.org/reverse`,
      {
        params: {
          lat: flat_result[index].lat,
          lon: flat_result[index].lon,
          format: "json",
        },
        headers: {
          "User-Agent": "PAWS (https://github.com/tkostadinov004/ragis)",
        },
      },
    );

    flat_result[index].address = reverse_geocoding_response.data.display_name;
  }
  console.log("Reversed geocoding finished.");
  return result.flat();
}
