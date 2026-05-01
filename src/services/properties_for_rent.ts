"use strict";

import axios from "axios";
import * as cheerio from "cheerio";

const categories: string[] = [
    "ofis", "magazin", "tyrgovski-obekt"
]

async function fetch_properties_per_category(category: string) {
  let index = 0;
  let pages_count: number | undefined;
  let result: string[] = new Array();
  while (!pages_count || index < pages_count) {
    console.log(`${category} - page ${index + 1}`);
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
        listings.push(link.value);
      }
    });

    await Promise.all(
      listings.map(async (link) => {
        const resp = await axios.get(`https://www.imoti.net${link}`);
        const listing = cheerio.load(resp.data);
        listing("#iframe-maps").each((_, m) => {
          const embed_url = m.attributes.find(
            (attr) => attr.name == "data-src",
          );
          if (!embed_url) {
            return;
          }
          const coords: string = embed_url.value.split("&")[1].split("=")[1];
          if (!coords.match("^0(\.0*)?,0(\.0*)?$")) { // skip unavailable coordinated
            result.push(coords);
          }
        });
      })
    );
  }
  return result;
}

export async function fetch_properties() {
    const result: string[][] = await Promise.all(categories.map(async (category) => await fetch_properties_per_category(category)));
    return result.flat();
}