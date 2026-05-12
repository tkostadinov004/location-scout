import { FeatureCollection, GeometryObject } from "geojson";
import {
  get_osm_data,
  insert_data_json_to_db,
  insert_data_to_db,
  insert_osm_query_record,
} from "../db/postgres-fetch";
import { fetch_from_osm } from "../utils/osm_data_fetcher";
import { fetch_osm_tags } from "../utils/osm_tag_fetcher";

export async function osm_data_fetch(query: string): Promise<string> {
  const table_name = crypto.randomUUID();
  const osm_data: string | null = await get_osm_data(query);
  if (osm_data) {
    await insert_data_json_to_db(osm_data, table_name);
  } else {
    const fetched_osm_data: FeatureCollection<GeometryObject> =
      await fetch_from_osm(await fetch_osm_tags(query));
    await insert_data_to_db(fetched_osm_data, table_name);
    await insert_osm_query_record(query, table_name);
  }
  return table_name;
}
