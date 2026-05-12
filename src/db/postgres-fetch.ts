import { FeatureCollection, GeometryObject } from "geojson";
import { ogr2ogr } from "ogr2ogr";
import { Pool } from "pg";
import tmp from "tmp";
import fs from "fs";
import { spawn } from "child_process";
import format from "pg-format";
import { table } from "console";
import { AdditionalCriterion } from "../services/score_calculator";

export class ScoreCalculationCommonData {
  total_sofia_population: number;
  max_rent: number;
  min_rent: number;

  constructor(tsp: number, max_rent: number, min_rent: number) {
    this.total_sofia_population = tsp;
    this.max_rent = max_rent;
    this.min_rent = min_rent;
  }
}

export class RentableObject {
  point: string = "";
  isochrone: string = "";
  isochrone_area: number = 0;
  name: string = "";
  url: string = "";
  address: string = "";
  rent_eur: string | number = 0;
  rent_bgn: string | number = 0;
  area: number = 0;
  approximate_customer_count: number = 0;
  rent_per_m2_eur: number | null = null;
  rent_per_m2_bgn: number | null = null;
  shortest_dist_to_park: number | null = null;
  shortest_dist_to_public_transport: number | null = null;
  shortest_dist_to_school: number | null = null;

  objects_of_same_type_in_isochrone: string = "";
  objects_of_same_type_in_isochrone_count: number = 0;
  base_score: number | null = null;
  total_score: number | null = null;

  parks_in_isochrone: string | null = null;
  public_transport_stops_in_isochrone: string | null = null;
  schools_in_isochrone: string | null = null;

  additional_pois: string | null = null;
  min_distance_to_additional_poi: number | null = null;

  constructor(init?: Partial<RentableObject>) {
    if (init) {
      Object.assign(this, init);
    }
  }
}

export async function get_common_data(): Promise<ScoreCalculationCommonData> {
  const min_max_rents: number[] = await get_min_max_rents();
  const sofia_population: number = await get_sofia_population();
  return new ScoreCalculationCommonData(
    sofia_population,
    min_max_rents[0],
    min_max_rents[1],
  );
}

const get_pg_pool = function () {
  return new Pool({
    user: process.env.PG_USER,
    host: process.env.PG_HOST,
    database: process.env.PG_DATABASE,
    password: process.env.PG_PASS,
    port: Number.parseInt(process.env.PG_PORT ?? ""),
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    ssl: true,
  });
};

async function get_sofia_population(): Promise<number> {
  const pool: Pool = get_pg_pool();
  let conn;
  try {
    conn = await pool.connect();
    const res = await conn.query(`
          select sum(ppl_sgr_30) as sum from teodorsk_work.population_per_building;
      `);
    return res.rows[0].sum;
  } finally {
    if (conn) {
      conn.release();
    }
  }
}

async function get_min_max_rents(): Promise<number[]> {
  const pool: Pool = get_pg_pool();
  let conn;
  try {
    conn = await pool.connect();
    const res = await conn.query(`
          select min(rent_per_m2_eur) as min_rent, max(rent_per_m2_eur) as max_rent from rentable_properties where rent_per_m2_eur is not null;
      `);
    return [
      Number.parseFloat(res.rows[0].min_rent ?? "0"),
      Number.parseFloat(res.rows[0].max_rent ?? "0"),
    ];
  } finally {
    if (conn) {
      conn.release();
    }
  }
}

export async function insert_data_json_to_db(
  objects_json: string,
  table_name: string,
) {
  await new Promise<void>((resolve, reject) => {
    const tmpFile = tmp.fileSync({ postfix: ".geojson" });
    fs.writeFileSync(tmpFile.name, objects_json);
    const args = [
      `-f`,
      `PostgreSQL`,
      `PG:host=${process.env.PG_HOST} port=${process.env.PG_PORT} user=${process.env.PG_USER} password=${process.env.PG_PASS} dbname=${process.env.PG_DATABASE} schemas=${process.env.PG_SCHEMA}`,
      tmpFile.name,
      `-lco`,
      `SCHEMA=${process.env.PG_SCHEMA}`,
      `-nln`,
      table_name,
    ];
    const child = spawn("ogr2ogr", args);

    child.stderr.on("data", (data) => {
      console.error(`GDAL Error: ${data}`);
    });

    child.on("error", (err) => {
      reject(`Failed to start process: ${err.message}`);
    });

    child.on("close", (code) => {
      if (code === 0) {
        tmpFile.removeCallback();
        resolve();
      } else {
        reject(`Process exited with code ${code}`);
      }
    });
  });

  await insert_centroids(table_name);
}

export async function insert_centroids(table_name: string) {
  const pool: Pool = get_pg_pool();
  let conn;
  try {
    conn = await pool.connect();
    const query_string = format(
      `
        alter table %I
        drop column if exists wkb_geometry_centroid,
        add column wkb_geometry_centroid geometry;
        update %I set wkb_geometry_centroid = st_centroid(wkb_geometry);
        `,
      table_name.replaceAll("-", "_"),
      table_name.replaceAll("-", "_"),
    );
    await conn.query(query_string);
  } finally {
    if (conn) {
      conn.release();
    }
  }
}

export async function insert_data_to_db(
  objects: FeatureCollection<GeometryObject>,
  table_name: string,
) {
  await insert_data_json_to_db(JSON.stringify(objects), table_name);
}

export async function remove_temp_table(table_name: string) {
  const pool: Pool = get_pg_pool();
  let conn;
  try {
    conn = await pool.connect();
    await conn.query(
      format(`drop table %I;`, [table_name.replaceAll("-", "_")]),
    );
  } finally {
    if (conn) {
      conn.release();
    }
  }
}

export async function get_osm_data(query: string): Promise<string | null> {
  const pool: Pool = get_pg_pool();
  let conn;
  try {
    conn = await pool.connect();
    const res = await conn.query(
      format(
        `
        select result
        from teodorsk_work.osm_queries
        where lower(query) = lower(%L);
        `,
        query,
      ),
    );
    const res_str: string[] = res.rows.map((r) => r.result);
    return res_str.length == 0 ? null : res_str[0];
  } finally {
    if (conn) {
      conn.release();
    }
  }
}

export async function insert_osm_query_record(
  query: string,
  data_table_name: string,
) {
  const pool: Pool = get_pg_pool();
  let conn;
  try {
    conn = await pool.connect();
    await conn.query(
      format(
        `
        insert into teodorsk_work.osm_queries (query, result) values (%L, table_to_geojson(%L));
        `,
        query,
        data_table_name.replaceAll("-", "_"),
      ),
    );
  } finally {
    if (conn) {
      conn.release();
    }
  }
}

export async function check_if_osm_data_exists(
  query: string,
): Promise<boolean> {
  const pool: Pool = get_pg_pool();
  let conn;
  try {
    conn = await pool.connect();
    const res = await conn.query(
      format(
        `
        select exists(select id 
        from teodorsk_work.osm_queries
        where query = %L);
        `,
        query,
      ),
    );
    return res.rows[0].exists;
  } finally {
    if (conn) {
      conn.release();
    }
  }
}

export async function get_rentable_objects(
  objects_of_same_type_table_name: string,
  additional_pois_table_name: string | null,
  additional_pois_fetch_type: boolean,
  additional_criteria: AdditionalCriterion[],
): Promise<RentableObject[]> {
  objects_of_same_type_table_name = objects_of_same_type_table_name.replaceAll(
    "-",
    "_",
  );
  if (additional_pois_table_name) {
    additional_pois_table_name = additional_pois_table_name.replaceAll(
      "-",
      "_",
    );
  }
  let query_string_unformatted = `
    ${
      additional_pois_table_name
        ? `
      with closest_point_to_additional_pois as 
      (
        select res.ogc_fid as rentable_id, res.id as closest_point_id, res.additional_pois from (
          select ap.ogc_fid, ap.wkb_geometry, row_number() over (partition by ap.ogc_fid order by pnnvp.the_geom <-> ap.wkb_geometry) as rn, pnnvp.id,
          st_collect(distinct st_centroid(ap.wkb_geometry)) as additional_pois
          from %I ap
          left join pedestrian_network_noded_vertices_pgr pnnvp on st_within(pnnvp.the_geom, st_buffer(ap.wkb_geometry::geography, 200)::geometry)
          group by ap.ogc_fid, pnnvp.id
        ) res
        where res.rn = 1
      )
      `
        : ""
    }
    select st_asgeojson(rp.wkb_geometry) as point, st_asgeojson(isochrone) as isochrone, st_area(isochrone::geography) as isochrone_area,
                name, url, address, rent_eur, rent_bgn, area,
                approximate_customer_count, rent_per_m2_eur, rent_per_m2_bgn, shortest_dist_to_park,
                shortest_dist_to_public_transport, shortest_dist_to_school, 
                st_asgeojson(st_collect(distinct st_centroid(same_objects_t.wkb_geometry))) as same_objects,
                count(distinct same_objects_t.wkb_geometry) as count_same
                ${additional_criteria.find((p) => p.type == "park") ? ", st_asgeojson(get_parks_centroids_in_area(isochrone)) as parks" : ""}
                ${additional_criteria.find((p) => p.type == "school") ? ", st_asgeojson(get_schools_centroids_in_area(isochrone)) as schools" : ""}
                ${additional_criteria.find((p) => p.type == "public_transport") ? ", st_asgeojson(get_public_transport_centroids_stops_in_area(isochrone)) as public_transport_stops" : ""}
                ${additional_pois_table_name ? `, st_asgeojson(cp.additional_pois)` : ""}
                ${
                  additional_pois_table_name
                    ? additional_pois_fetch_type
                      ? `, st_distance(rp.wkb_geometry::geography, (select p.wkb_geometry from %I p order by p.wkb_geometry <-> rp.wkb_geometry limit 1)::geography) / 1000 as min_distance_to_additional_poi`
                      : `, (select agg_cost / 1000 from pgr_dijkstraCost('SELECT id, source, target, meters as cost FROM pedestrian_network_noded', rp.closest_vertex, cp.closest_point_id, false)) as min_distance_to_additional_poi`
                    : ""
                }
            from teodorsk_work.rentable_properties rp ${additional_pois_table_name ? `left join closest_point_to_additional_pois cp on cp.rentable_id = rp.ogc_fid` : ""} left join %I as same_objects_t on st_within(same_objects_t.wkb_geometry, isochrone)
            group by rp.ogc_fid ${additional_pois_table_name ? ", cp.closest_point_id, cp.additional_pois" : ""};
    `;
  let query_string_formatted: string = "";
  if (additional_pois_table_name) {
    if (additional_pois_fetch_type) {
      query_string_formatted = format(
        query_string_unformatted,
        additional_pois_table_name,
        additional_pois_table_name,
        objects_of_same_type_table_name,
      );
    } else {
      query_string_formatted = format(
        query_string_unformatted,
        additional_pois_table_name,
        objects_of_same_type_table_name,
      );
    }
  } else {
    query_string_formatted = format(
      query_string_unformatted,
      objects_of_same_type_table_name,
    );
  }

  console.log(query_string_formatted);

  const pool: Pool = get_pg_pool();
  let conn;
  try {
    conn = await pool.connect();
    const res = await conn.query(query_string_formatted);
    return res.rows.map(
      (r) =>
        new RentableObject({
          point: r.point,
          isochrone: r.isochrone,
          isochrone_area: r.isochrone_area,
          name: r.name,
          url: r.url,
          address: r.address,
          rent_eur: r.rent_eur,
          rent_bgn: r.rent_bgn,
          area: r.area,
          approximate_customer_count: r.approximate_customer_count,
          rent_per_m2_eur: r.rent_per_m2_eur,
          rent_per_m2_bgn: r.rent_per_m2_bgn,
          shortest_dist_to_park: r.shortest_dist_to_park,
          shortest_dist_to_public_transport:
            r.shortest_dist_to_public_transport,
          shortest_dist_to_school: r.shortest_dist_to_school,
          objects_of_same_type_in_isochrone: r.same_objects,
          objects_of_same_type_in_isochrone_count: r.count_same,
          parks_in_isochrone: r.parks ? r.parks : null,
          schools_in_isochrone: r.schools ? r.schools : null,
          public_transport_stops_in_isochrone: r.public_transport_stops
            ? r.public_transport_stops
            : null,
          additional_pois: r.additional_pois,
          min_distance_to_additional_poi: r.min_distance_to_additional_poi,
        }),
    );
  } finally {
    if (conn) {
      conn.release();
    }
  }
}
